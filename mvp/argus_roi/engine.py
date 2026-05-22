#!/usr/bin/env python3
"""
Argus ROI Engine — MVP
======================

The smallest thing that proves the Argus thesis: connect to a real operational
Postgres, run a catalog of opportunity playbooks, SIZE every finding in money,
and emit a board-grade memo with prioritized actions — every number traceable
to the SQL that produced it.

This is the v0 runner described in docs/STRATEGY.md §"What to start tomorrow":
    "Python script, takes a DB + playbook dir, outputs a markdown memo."

Design (mirrors docs/AGENT_LOOPS.md):
  - The DATABASE is the truth oracle. Every number reduces to a SQL row.
  - Severity & sizing are DETERMINISTIC (Python), not LLM-guessed.
  - Every finding ships with its receipt SQL. No receipt -> not shipped.

No external Python deps beyond PyYAML — queries run through the `psql` CLI,
which already authenticates via local peer auth. Swap in psycopg later.

Usage:
    python3 engine.py                       # run all playbooks, print memo
    python3 engine.py --out memo.md         # also write the memo to a file
    python3 engine.py --json findings.json  # dump structured findings
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
PLAYBOOK_DIR = HERE / "playbooks"
PSQL_USER = os.environ.get("ARGUS_PG_USER", "mehdi")
CURRENCY = "TND"


# --------------------------------------------------------------------------
# DB access — psql subprocess (peer auth, no password). One row in, dict out.
# --------------------------------------------------------------------------
def run_sql(database: str, sql: str) -> list[dict]:
    """Run SQL and return rows as list of dicts. Uses psql -tA with a header."""
    # We ask psql for an unaligned result WITH a header row so we can map
    # column names. Field separator is a tab (won't appear in our numerics).
    cmd = ["psql", "-U", PSQL_USER, "-d", database, "-tA", "-F", "\t", "--no-psqlrc"]
    # Re-add the header by wrapping: psql -A drops the header unless we keep it.
    cmd = ["psql", "-U", PSQL_USER, "-d", database, "-A", "-F", "\t", "--no-psqlrc",
           "-P", "footer=off"]
    proc = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"SQL failed on db={database}:\n{proc.stderr.strip()}")
    lines = [l for l in proc.stdout.splitlines() if l.strip() != ""]
    if not lines:
        return []
    header = lines[0].split("\t")
    rows = []
    for line in lines[1:]:
        vals = line.split("\t")
        rows.append(dict(zip(header, vals)))
    return rows


def num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


# --------------------------------------------------------------------------
# Finding model
# --------------------------------------------------------------------------
@dataclass
class Finding:
    id: str
    title: str
    kind: str               # "opportunity" | "risk" | "recovery"
    severity: str           # critical | high | medium | low
    headline: str
    gross_value: float      # the raw number from the DB
    opportunity_value: float  # conservative realizable value (the ROI)
    basis: str              # how opportunity_value was derived
    recommended_action: str
    metrics: dict           # raw detection row(s)
    receipt_sql: str
    database: str


SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
SEV_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}


def evaluate_severity(rules: list[dict], row: dict) -> str:
    """First matching rule wins. Rule: {if: '<py expr>', level: 'high'}."""
    env = {k: num(v) for k, v in row.items()}
    for rule in rules or []:
        try:
            if eval(rule["if"], {"__builtins__": {}}, env):
                return rule["level"]
        except Exception:
            continue
    return "low"


def run_playbook(pb: dict) -> Finding | None:
    db = pb["database"]
    rows = run_sql(db, pb["detection_sql"])
    if not rows:
        return None
    row = rows[0]  # detection SQL returns one summary row

    env = {k: num(v) for k, v in row.items()}
    gross = num(env.get(pb["sizing"]["gross_metric"], 0))

    # realization factor turns gross exposure into conservative realizable ROI
    factor = float(pb["sizing"].get("realization_factor", 1.0))
    opportunity = gross * factor

    severity = evaluate_severity(pb.get("severity", []), row)

    headline = pb["headline"].format(
        **{k: fmt_money(num(v)) if _looks_money(k) else v for k, v in row.items()}
    )

    return Finding(
        id=pb["id"],
        title=pb["title"],
        kind=pb.get("kind", "opportunity"),
        severity=severity,
        headline=headline,
        gross_value=gross,
        opportunity_value=opportunity,
        basis=pb["sizing"]["basis"].format(
            factor_pct=f"{factor*100:.0f}%",
            gross=fmt_money(gross),
            opportunity=fmt_money(opportunity),
        ),
        recommended_action=pb["recommended_action"],
        metrics=row,
        receipt_sql=pb["detection_sql"].strip(),
        database=db,
    )


def _looks_money(col: str) -> bool:
    return any(t in col.lower() for t in ("tnd", "value", "amount", "fees", "cod", "owed", "revenue"))


def fmt_money(v: float) -> str:
    return f"{v:,.0f} {CURRENCY}"


# --------------------------------------------------------------------------
# Memo composer (deterministic, template-based — no hallucinated numbers)
# --------------------------------------------------------------------------
def compose_memo(findings: list[Finding], use_llm: bool = False) -> str:
    findings = sorted(findings, key=lambda f: (SEV_RANK[f.severity], -f.opportunity_value))
    opps = [f for f in findings if f.kind in ("opportunity", "recovery")]
    risks = [f for f in findings if f.kind == "risk"]

    total_opportunity = sum(f.opportunity_value for f in opps)
    total_at_risk = sum(f.opportunity_value for f in risks)

    today = dt.date.today().isoformat()
    L = []
    L.append(f"# Argus Operational Intelligence Memo")
    L.append(f"_Generated {today} · source: live Postgres · every number links to its SQL receipt_")
    L.append("")

    # Optional LLM narrative (prose only — numbers stay deterministic).
    if use_llm:
        try:
            from composer import compose_narrative
            res = compose_narrative([asdict(f) for f in findings],
                                    {"opportunity": total_opportunity, "at_risk": total_at_risk})
            if res.get("narrative"):
                L.append("## Executive summary")
                L.append("")
                L.append(res["narrative"])
                L.append("")
                L.append(f"_↑ narrative by {res['provider']}/{res['model']} — "
                         f"prose only; all figures are deterministic SQL results._")
                L.append("")
        except Exception:
            pass  # LLM is a nice-to-have; deterministic memo always ships

    L.append("## Bottom line")
    L.append("")
    L.append(f"- **{fmt_money(total_opportunity)}** in identified recoverable / realizable value this quarter")
    L.append(f"- **{fmt_money(total_at_risk)}** in revenue exposed to concentration risk")
    L.append(f"- **{len(findings)}** opportunities found across {len(set(f.database for f in findings))} databases")
    L.append("")
    L.append("| # | Finding | Sev | Realizable value | Action |")
    L.append("|---|---|---|--:|---|")
    for i, f in enumerate(findings, 1):
        L.append(f"| {i} | {f.title} | {SEV_EMOJI[f.severity]} {f.severity} | "
                 f"**{fmt_money(f.opportunity_value)}** | {f.recommended_action.splitlines()[0][:60]} |")
    L.append("")
    L.append("---")
    L.append("")
    for i, f in enumerate(findings, 1):
        L.append(f"## {i}. {f.title}  {SEV_EMOJI[f.severity]}")
        L.append("")
        L.append(f"**{f.headline}**")
        L.append("")
        L.append(f"- **Realizable value: {fmt_money(f.opportunity_value)}** "
                 f"(gross exposure {fmt_money(f.gross_value)})")
        L.append(f"- Sizing basis: {f.basis}")
        L.append(f"- Recommended action: {f.recommended_action}")
        L.append(f"- Source DB: `{f.database}`")
        L.append("")
        L.append("<details><summary>📎 Receipt SQL (click to verify)</summary>")
        L.append("")
        L.append("```sql")
        L.append(f.receipt_sql)
        L.append("```")
        L.append("")
        L.append("Detection result:")
        L.append("")
        L.append("| " + " | ".join(f.metrics.keys()) + " |")
        L.append("|" + "|".join(["---"] * len(f.metrics)) + "|")
        L.append("| " + " | ".join(str(v) for v in f.metrics.values()) + " |")
        L.append("")
        L.append("</details>")
        L.append("")
    L.append("---")
    L.append("")
    L.append("## Methodology")
    L.append("")
    L.append("- **The database is the calculator.** Every headline number is a SQL result, not an LLM estimate.")
    L.append("- **Realizable value** = gross exposure × a conservative realization factor (stated per finding).")
    L.append("- **Severity** is rule-based and deterministic.")
    L.append("- Click any receipt to re-run the exact query and verify the rows.")
    return "\n".join(L)


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="write memo to this markdown file")
    ap.add_argument("--json", help="dump structured findings to this json file")
    ap.add_argument("--playbooks", default=str(PLAYBOOK_DIR))
    ap.add_argument("--llm", action="store_true",
                    help="add an LLM-written executive summary (uses ARGUS_* provider from .env)")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.playbooks, "*.yaml")))
    if not files:
        print(f"No playbooks found in {args.playbooks}", file=sys.stderr)
        sys.exit(1)

    findings: list[Finding] = []
    for fp in files:
        pb = yaml.safe_load(Path(fp).read_text())
        try:
            f = run_playbook(pb)
            if f:
                findings.append(f)
                print(f"  ✓ {pb['id']:32s} {fmt_money(f.opportunity_value):>20s}  [{f.severity}]",
                      file=sys.stderr)
            else:
                print(f"  – {pb['id']:32s} no rows", file=sys.stderr)
        except Exception as e:
            print(f"  ✗ {pb['id']:32s} ERROR: {e}", file=sys.stderr)

    memo = compose_memo(findings, use_llm=args.llm)
    print("\n" + "=" * 70 + "\n", file=sys.stderr)
    print(memo)

    if args.out:
        Path(args.out).write_text(memo)
        print(f"\n[memo written to {args.out}]", file=sys.stderr)
    if args.json:
        Path(args.json).write_text(json.dumps([asdict(f) for f in findings], indent=2))
        print(f"[findings written to {args.json}]", file=sys.stderr)


if __name__ == "__main__":
    main()
