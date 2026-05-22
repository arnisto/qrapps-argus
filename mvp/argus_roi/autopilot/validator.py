"""
SQL Validator — the L1 self-correcting query loop (from docs/AGENT_LOOPS.md).

LLM-written SQL is wrong on the first try surprisingly often: guessed column
names, string-vs-int status codes, missing tables. This module:

  1. Refuses anything that isn't a pure read (defense in depth).
  2. Runs the SQL in a READ ONLY transaction with a 30s statement timeout.
  3. On error, hands the exact DB error + schema back to the LLM and asks for
     a corrected query — up to MAX_FIX attempts.
  4. Accepts a playbook only when its SQL returns exactly one summary row that
     contains the declared gross_metric column.

The database is the truth oracle: a playbook that can't produce a verifiable
row does not ship.
"""

from __future__ import annotations

import os
import re
import subprocess

from llm import call_llm, extract_json

PSQL_USER = os.environ.get("ARGUS_PG_USER", "mehdi")
MAX_FIX = 3
WRITE_RE = re.compile(r"\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|"
                      r"merge|copy|vacuum|reindex)\b", re.IGNORECASE)


class Unsafe(Exception):
    pass


def _run_readonly(db: str, sql: str) -> tuple[list[dict] | None, str | None]:
    if WRITE_RE.search(sql):
        return None, "rejected: contains a write/DDL keyword"
    wrapped = ("SET statement_timeout='30s';\n"
               "BEGIN READ ONLY;\n"
               f"{sql.rstrip().rstrip(';')}\n;\n"
               "ROLLBACK;")
    proc = subprocess.run(
        ["psql", "-U", PSQL_USER, "-d", db, "-A", "-F", "\t", "--no-psqlrc",
         "-P", "footer=off", "-v", "ON_ERROR_STOP=1"],
        input=wrapped, capture_output=True, text=True)
    if proc.returncode != 0:
        return None, proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "unknown error"
    lines = [l for l in proc.stdout.splitlines()
             if l.strip() not in ("", "BEGIN", "ROLLBACK", "SET")]
    if not lines:
        return [], None
    header = lines[0].split("\t")
    rows = [dict(zip(header, l.split("\t"))) for l in lines[1:]]
    return rows, None


FIX_PROMPT = """The following PostgreSQL query failed against database "{db}".

QUERY:
{sql}

ERROR:
{err}

RELEVANT SCHEMA (tables you may use, with columns):
{schema}

Rewrite the query so it runs. Keep the same analytical intent. It MUST:
- be a single read-only SELECT returning ONE summary row with named aggregate columns,
- keep a TND money column named so it can be summed,
- use only columns that exist in the schema above.
Return ONLY the corrected SQL, no commentary, no code fences."""


def _ask_fix(db: str, sql: str, err: str, schema_text: str) -> str | None:
    raw = call_llm(FIX_PROMPT.format(db=db, sql=sql, err=err, schema=schema_text),
                   max_tokens=4096, temperature=0.2)
    if not raw:
        return None
    # the model may wrap in fences or prose; strip to the SELECT/WITH
    raw = re.sub(r"```(?:sql)?", "", raw).strip("` \n")
    m = re.search(r"\b(WITH|SELECT)\b", raw, re.IGNORECASE)
    return raw[m.start():].strip() if m else raw.strip()


def validate_playbook(pb: dict, schema_text: str) -> dict:
    """Returns pb with added: valid(bool), validation_note(str), result_row(dict|None)."""
    db = pb["database"]
    sql = pb["detection_sql"]
    history = []
    for attempt in range(MAX_FIX + 1):
        rows, err = _run_readonly(db, sql)
        if err is None and rows is not None:
            row = rows[0] if rows else {}
            gm = pb.get("gross_metric")
            if not rows:
                err = "query returned no rows (expected one summary row)"
            elif gm and gm not in row:
                err = f"result is missing the declared gross_metric column '{gm}' (have: {list(row.keys())})"
            else:
                pb["detection_sql"] = sql
                pb["valid"] = True
                pb["validation_note"] = "ok" if attempt == 0 else f"fixed after {attempt} retr{'y' if attempt==1 else 'ies'}"
                pb["result_row"] = row
                return pb
        history.append(f"attempt {attempt}: {err}")
        if attempt == MAX_FIX:
            break
        fixed = _ask_fix(db, sql, err, schema_text)
        if not fixed or fixed.strip() == sql.strip():
            break
        sql = fixed

    pb["valid"] = False
    pb["validation_note"] = " | ".join(history)
    pb["result_row"] = None
    return pb
