#!/usr/bin/env python3
"""
Argus Autopilot — the autonomous loop.

    map  ->  generate  ->  validate (+self-correct)  ->  size  ->  persist  ->  compose

A daily cron runs this. It introspects the target DB, asks the LLM to invent
opportunity playbooks, self-corrects their SQL against the live DB, sizes every
survivor in money, writes a board memo, and stores EVERYTHING in Postgres +
Redis (no result files).

Usage:
    python3 autopilot.py                 # analyse default target (intigo)
    python3 autopilot.py --target intigo --n 8
    python3 autopilot.py --no-llm-narrative
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

import store
from mapper import map_database
from generator import generate_playbooks, _compact_schema
from validator import validate_playbook
from llm import call_llm, model_id

SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
SEV_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}
CUR = "TND"


def num(x):
    try:
        return float(str(x).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def money(v):
    return f"{v:,.0f} {CUR}"


def severity(rules, row):
    env = {k: num(v) for k, v in row.items()}
    for r in rules or []:
        try:
            if eval(r["if"], {"__builtins__": {}}, env):
                return r.get("level", "low")
        except Exception:
            continue
    return "low"


def size(pb, row):
    gross = num(row.get(pb.get("gross_metric", ""), 0))
    factor = float(pb.get("realization_factor", 1.0) or 1.0)
    return gross, gross * factor


def build_finding(pb, row) -> dict:
    gross, opp = size(pb, row)
    sev = severity(pb.get("severity", []), row)
    basis = (pb.get("basis") or "").format(
        gross=money(gross), opportunity=money(opp),
        factor_pct=f"{float(pb.get('realization_factor',1.0))*100:.0f}%")
    return {
        "id": pb.get("id", "unnamed"),
        "title": pb.get("title", pb.get("id", "unnamed")),
        "kind": pb.get("kind", "opportunity"),
        "severity": sev,
        "headline": pb.get("hypothesis", "")[:240],
        "gross_value": round(gross, 2),
        "opportunity_value": round(opp, 2),
        "basis": basis or f"{money(gross)} gross × realization factor.",
        "recommended_action": pb.get("recommended_action", ""),
        "metrics": row,
        "receipt_sql": pb["detection_sql"].strip(),
    }


def llm_summary(findings, totals) -> str | None:
    facts = "\n".join(
        f"- {f['title']} [{f['severity']}]: realizable {money(f['opportunity_value'])} "
        f"(gross {money(f['gross_value'])})" for f in findings)
    prompt = (f"You are writing the opening of a weekly memo to the CEO of a Tunisian "
              f"logistics company (currency TND). These numbers are FACTS from a SQL engine — "
              f"never change or invent figures.\n\nTotal realizable: {money(totals['opp'])}. "
              f"Total at risk: {money(totals['risk'])}.\n{facts}\n\n"
              f"Write 4-6 crisp sentences: lead with the biggest opportunity, name the top 3 "
              f"actions for this week. Plain business English, no fluff. Use only the numbers above. "
              f"Output only the prose.")
    return call_llm(prompt, max_tokens=4096, temperature=0.4)


def compose_memo(findings, totals, run_id, target, narrative) -> str:
    findings = sorted(findings, key=lambda f: (SEV_RANK[f["severity"]], -f["opportunity_value"]))
    L = [f"# Argus Autopilot Memo — {target}",
         f"_Run #{run_id} · {dt.date.today().isoformat()} · playbooks invented by {model_id()} · "
         f"every number is a verified SQL result_", ""]
    if narrative:
        L += ["## Executive summary", "", narrative, "",
              f"_↑ narrative by {model_id()} — prose only; figures are deterministic._", ""]
    L += ["## Bottom line", "",
          f"- **{money(totals['opp'])}** realizable value identified",
          f"- **{money(totals['risk'])}** revenue at risk",
          f"- **{len(findings)}** opportunities, all SQL-verified", "",
          "| # | Finding | Sev | Realizable | Action |", "|---|---|---|--:|---|"]
    for i, f in enumerate(findings, 1):
        act = (f["recommended_action"] or "").splitlines()[0][:55] if f["recommended_action"] else ""
        L.append(f"| {i} | {f['title']} | {SEV_EMOJI[f['severity']]} {f['severity']} | "
                 f"**{money(f['opportunity_value'])}** | {act} |")
    L.append("")
    for i, f in enumerate(findings, 1):
        L += [f"## {i}. {f['title']} {SEV_EMOJI[f['severity']]}", "",
              f"**{f['headline']}**", "",
              f"- Realizable: **{money(f['opportunity_value'])}** (gross {money(f['gross_value'])})",
              f"- Basis: {f['basis']}",
              f"- Action: {f['recommended_action']}", "",
              "<details><summary>📎 Receipt SQL</summary>", "", "```sql", f["receipt_sql"], "```",
              "", "Result: `" + ", ".join(f"{k}={v}" for k, v in f["metrics"].items()) + "`",
              "", "</details>", ""]
    return "\n".join(L)


def run(target: str, n: int, use_narrative: bool) -> dict:
    log = lambda m: print(m, file=sys.stderr)
    store.init_schema()
    run_id = store.start_run(target)
    log(f"[run #{run_id}] target={target}")

    log("① mapping schema…")
    schema = map_database(target)
    store.save_schema_map(target, schema)
    schema_text = _compact_schema(schema)
    log(f"   mapped {len(schema['tables'])} tables")

    log(f"② generating {n} playbooks via {model_id()}…")
    pbs = generate_playbooks(schema, n=n)
    log(f"   generated {len(pbs)}")

    log("③ validating + self-correcting SQL…")
    findings, valid = [], 0
    for pb in pbs:
        vp = validate_playbook(pb, schema_text)
        store.save_playbook(target, vp, vp["valid"], vp["validation_note"], model_id())
        status = "✓" if vp["valid"] else "✗"
        log(f"   {status} {pb.get('id','?'):42s} {vp['validation_note'][:50]}")
        if vp["valid"] and vp.get("result_row"):
            valid += 1
            findings.append(build_finding(vp, vp["result_row"]))

    opp = sum(f["opportunity_value"] for f in findings if f["kind"] in ("opportunity", "recovery"))
    risk = sum(f["opportunity_value"] for f in findings if f["kind"] == "risk")
    totals = {"opp": opp, "risk": risk}

    log("④ composing memo…")
    narrative = llm_summary(findings, totals) if (use_narrative and findings) else None
    memo = compose_memo(findings, totals, run_id, target, narrative)

    log("⑤ persisting to Postgres + Redis…")
    store.save_findings(run_id, findings)
    store.finish_run(run_id, "succeeded", len(pbs), valid, opp, risk, memo)
    store.cache_latest({
        "run_id": run_id, "target": target, "generated_at": dt.datetime.now().isoformat(),
        "total_opportunity": round(opp, 2), "total_at_risk": round(risk, 2),
        "n_findings": len(findings), "memo_md": memo,
        "findings": [{k: f[k] for k in ("id", "title", "severity", "opportunity_value")} for f in findings],
    })
    log(f"[run #{run_id}] done — {len(findings)} findings, {money(opp)} realizable\n")
    return {"run_id": run_id, "memo": memo, "opp": opp, "risk": risk, "findings": findings}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default="intigo")
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--no-llm-narrative", action="store_true")
    ap.add_argument("--print-memo", action="store_true")
    args = ap.parse_args()
    res = run(args.target, args.n, not args.no_llm_narrative)
    if args.print_memo:
        print(res["memo"])


if __name__ == "__main__":
    main()
