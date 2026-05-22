"""
Resource Mapper — introspects a target Postgres into a compact schema map.

The map is what the LLM reasons over to invent playbooks, so it must be
information-dense but small: the biggest tables (by estimated row count),
their columns + types, foreign-key relationships, and a few sampled values
for low-cardinality / money / status columns that hint at business meaning.

Read-only. Uses pg_class.reltuples estimates (instant) instead of COUNT(*)
so it stays fast even on multi-million-row tables.
"""

from __future__ import annotations

import json
import os
import subprocess

PSQL_USER = os.environ.get("ARGUS_PG_USER", "mehdi")


def _q(db: str, sql: str) -> list[dict]:
    proc = subprocess.run(
        ["psql", "-U", PSQL_USER, "-d", db, "-A", "-F", "\t", "--no-psqlrc",
         "-P", "footer=off", "-v", "ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"map query failed on {db}: {proc.stderr.strip()}")
    lines = [l for l in proc.stdout.splitlines() if l.strip() != ""]
    if not lines:
        return []
    header = lines[0].split("\t")
    return [dict(zip(header, l.split("\t"))) for l in lines[1:]]


def map_database(db: str, top_n_tables: int = 40, sample_values: bool = True) -> dict:
    # 1. biggest tables by estimated row count
    tables = _q(db, f"""
        SELECT c.relname AS table_name,
               GREATEST(c.reltuples::bigint, 0) AS est_rows
        FROM   pg_class c
        JOIN   pg_namespace n ON n.oid = c.relnamespace
        WHERE  n.nspname = 'public' AND c.relkind = 'r'
        ORDER  BY c.reltuples DESC
        LIMIT  {top_n_tables};
    """)
    table_names = [t["table_name"] for t in tables]
    if not table_names:
        return {"target_db": db, "tables": []}

    name_list = ",".join(f"'{t}'" for t in table_names)

    # 2. columns for those tables
    cols = _q(db, f"""
        SELECT table_name, column_name, data_type
        FROM   information_schema.columns
        WHERE  table_schema='public' AND table_name IN ({name_list})
        ORDER  BY table_name, ordinal_position;
    """)
    cols_by_table: dict[str, list] = {}
    for c in cols:
        cols_by_table.setdefault(c["table_name"], []).append(
            {"name": c["column_name"], "type": c["data_type"]})

    # 3. foreign keys among them
    fks = _q(db, f"""
        SELECT tc.table_name AS from_table, kcu.column_name AS from_col,
               ccu.table_name AS to_table, ccu.column_name AS to_col
        FROM   information_schema.table_constraints tc
        JOIN   information_schema.key_column_usage kcu
               ON kcu.constraint_name = tc.constraint_name
        JOIN   information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name
        WHERE  tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
          AND  tc.table_name IN ({name_list});
    """)
    fks_by_table: dict[str, list] = {}
    for fk in fks:
        fks_by_table.setdefault(fk["from_table"], []).append(
            f"{fk['from_col']} -> {fk['to_table']}.{fk['to_col']}")

    # 4. assemble; optionally sample a couple distinct values for status-ish cols
    out_tables = []
    for t in tables:
        tn = t["table_name"]
        tcols = cols_by_table.get(tn, [])
        entry = {
            "name": tn,
            "est_rows": int(t["est_rows"]),
            "columns": tcols,
            "foreign_keys": fks_by_table.get(tn, []),
        }
        if sample_values and int(t["est_rows"]) > 0:
            # sample distinct values for a status/type column if present (cheap, capped)
            status_col = next((c["name"] for c in tcols
                               if c["name"].lower() in ("status", "type", "kind", "state",
                                                         "bill_status", "payment_method")), None)
            if status_col:
                try:
                    vals = _q(db, f"SELECT DISTINCT {status_col} AS v FROM public.\"{tn}\" "
                                  f"WHERE {status_col} IS NOT NULL LIMIT 8;")
                    entry["sample_" + status_col] = [r["v"] for r in vals]
                except Exception:
                    pass
        out_tables.append(entry)

    return {"target_db": db, "tables": out_tables}


if __name__ == "__main__":
    import sys
    db = sys.argv[1] if len(sys.argv) > 1 else "intigo"
    m = map_database(db)
    print(json.dumps(m, indent=2)[:3000])
    print(f"\n... mapped {len(m['tables'])} tables")
