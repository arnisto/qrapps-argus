"""
Playbook Generator — the "mind".

Feeds the schema map to the LLM and asks it to invent opportunity-detection
playbooks: a hypothesis, the SQL to test it, how to size the finding in money,
severity rules, and a recommended action. This is what makes Argus autonomous
rather than a fixed report — it discovers what's worth looking at.

Output contract per playbook (JSON):
  {
    "id": "snake_case_key",
    "title": "...",
    "kind": "opportunity|risk|recovery",
    "hypothesis": "...",
    "detection_sql": "SELECT ... (ONE summary row, named metric columns)",
    "gross_metric": "<column name in the result to size on>",
    "realization_factor": 0.0-1.0,
    "basis": "one-line sizing rationale (may use {gross}/{opportunity}/{factor_pct})",
    "severity": [{"if": "<py expr over result cols>", "level": "critical|high|medium|low"}],
    "recommended_action": "..."
  }
"""

from __future__ import annotations

import json
import re
from llm import call_llm, extract_json


def _compact_schema(schema: dict, max_cols: int = 30) -> str:
    lines = []
    for t in schema.get("tables", []):
        cols = t["columns"][:max_cols]
        col_str = ", ".join(f"{c['name']}:{_short_type(c['type'])}" for c in cols)
        line = f"- {t['name']} (~{t['est_rows']:,} rows): {col_str}"
        if t.get("foreign_keys"):
            line += f"  | FKs: {'; '.join(t['foreign_keys'][:6])}"
        # include any sampled status values
        for k, v in t.items():
            if k.startswith("sample_"):
                line += f"  | {k}={v}"
        lines.append(line)
    return "\n".join(lines)


def _norm_kind(k: str) -> str:
    """Map the LLM's free-text kind to a canonical bucket."""
    k = str(k).lower()
    if "risk" in k or "exposure" in k or "concentration" in k:
        return "risk"
    if any(w in k for w in ("recover", "cash", "leak", "overdue", "unpaid",
                            "uncollected", "owed", "discrepan")):
        return "recovery"
    return "opportunity"


def _short_type(t: str) -> str:
    return {
        "character varying": "str", "text": "str", "timestamp with time zone": "ts",
        "timestamp without time zone": "ts", "numeric": "num", "integer": "int",
        "bigint": "int", "smallint": "int", "boolean": "bool", "double precision": "float",
        "date": "date", "jsonb": "json", "uuid": "uuid",
    }.get(t, t)


PROMPT = """You are a senior operational/financial analyst for {db}, a Tunisian logistics company (currency: TND). Below is the live database schema (biggest tables, columns, foreign keys, and sampled status values).

Invent {n} HIGH-VALUE opportunity-detection playbooks a CEO would pay for. Each playbook finds money: recoverable cash, leakage, risk exposure, or growth opportunity — and sizes it in TND.

SCHEMA:
{schema}

HARD RULES for the SQL you write:
1. Each detection_sql MUST return exactly ONE row of summary metrics with clear column aliases (use COUNT, SUM, etc. — never raw row dumps).
2. Read-only SELECT only. No INSERT/UPDATE/DELETE/DDL.
3. Use only tables and columns that appear in the schema above. Do not invent columns.
4. One of the result columns must be a TND money figure; name it in "gross_metric".
5. Prefer filters that isolate a real, actionable problem (e.g. unpaid, lost, dormant, overdue, concentrated).
6. status/type columns: use the sampled values shown to write correct filters.

For sizing, set realization_factor to the fraction of the gross that is realistically capturable (e.g. 0.8 for payroll-deductible cash owed, 0.05 for win-back campaigns, 1.0 for revenue-at-risk).

Return ONLY a JSON array of {n} playbook objects with these exact keys:
id, title, kind, hypothesis, detection_sql, gross_metric, realization_factor, basis, severity, recommended_action

"severity" is a list of {{"if": "<python boolean expr over the result column names>", "level": "critical|high|medium|low"}} rules, most-severe first.

Output the JSON array and nothing else."""


def generate_playbooks(schema: dict, n: int = 8) -> list[dict]:
    prompt = PROMPT.format(db=schema["target_db"], n=n, schema=_compact_schema(schema))
    raw = call_llm(prompt, max_tokens=16384, temperature=0.4)
    pbs = extract_json(raw) if raw else None
    if not isinstance(pbs, list):
        return []
    # normalise + attach target db
    out = []
    for pb in pbs:
        if not isinstance(pb, dict) or "detection_sql" not in pb:
            continue
        pb["kind"] = _norm_kind(pb.get("kind", "opportunity"))
        pb.setdefault("realization_factor", 1.0)
        pb.setdefault("severity", [])
        # LLMs sometimes return id/title as ints — coerce to clean string slugs
        pb["id"] = re.sub(r"[^a-z0-9_]+", "_", str(pb.get("id", f"pb_{len(out)+1}")).lower()).strip("_") or f"pb_{len(out)+1}"
        pb["title"] = str(pb.get("title", pb["id"]))
        pb["database"] = schema["target_db"]
        out.append(pb)
    return out


if __name__ == "__main__":
    import sys
    from mapper import map_database
    db = sys.argv[1] if len(sys.argv) > 1 else "intigo"
    schema = map_database(db)
    pbs = generate_playbooks(schema, n=6)
    print(f"generated {len(pbs)} playbooks\n")
    for p in pbs:
        print(f"### {p.get('id')} — {p.get('title')} [{p.get('kind')}]")
        print(f"    hypothesis: {p.get('hypothesis','')[:100]}")
        print(f"    sql: {' '.join(p['detection_sql'].split())[:160]}")
        print()
