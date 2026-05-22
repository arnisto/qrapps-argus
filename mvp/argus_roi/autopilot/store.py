"""
Persistence layer for Argus Autopilot.

Durable storage  -> the `argus` control-plane Postgres (Docker, :5434).
Hot cache        -> the `argus` Redis (Docker, :6381), key 'argus:latest'.

No result files. Everything the loop produces lands in Postgres; the most
recent memo + findings are mirrored to Redis for instant dashboard reads.

Uses psql / redis-cli subprocesses so there are no Python driver deps.
JSON values are passed via dollar-quoting to sidestep escaping.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent

ARGUS_PG_URL = "postgresql://argus:argus@localhost:5434/argus"
REDIS_CONTAINER = "argus-redis"


# ---- Postgres -------------------------------------------------------------
def pg(sql: str, capture: bool = False) -> list[dict]:
    args = ["psql", ARGUS_PG_URL, "--no-psqlrc", "-v", "ON_ERROR_STOP=1"]
    if capture:
        args += ["-A", "-F", "\t", "-P", "footer=off"]
    else:
        args += ["-q"]
    proc = subprocess.run(args, input=sql, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"argus-pg error:\n{proc.stderr.strip()}")
    if not capture:
        return []
    lines = [l for l in proc.stdout.splitlines() if l.strip() != ""]
    if not lines:
        return []
    header = lines[0].split("\t")
    return [dict(zip(header, l.split("\t"))) for l in lines[1:]]


def dq(value) -> str:
    """Dollar-quote any string/json safely for inline SQL."""
    if value is None:
        return "NULL"
    s = value if isinstance(value, str) else json.dumps(value)
    tag = "$ap$"
    if tag in s:
        tag = "$ap_x$"
    return f"{tag}{s}{tag}"


def init_schema():
    pg(Path(HERE / "schema.sql").read_text())


# ---- Redis ----------------------------------------------------------------
def redis_set(key: str, value: str):
    subprocess.run(
        ["docker", "exec", "-i", REDIS_CONTAINER, "redis-cli", "-x", "set", key],
        input=value, capture_output=True, text=True,
    )


def redis_get(key: str) -> str | None:
    p = subprocess.run(
        ["docker", "exec", REDIS_CONTAINER, "redis-cli", "get", key],
        capture_output=True, text=True,
    )
    return p.stdout.strip() or None


# ---- high-level operations ------------------------------------------------
def save_schema_map(target_db: str, schema_json: dict) -> int:
    rows = pg(
        f"INSERT INTO autopilot.schema_map (target_db, table_count, schema_json) "
        f"VALUES ({dq(target_db)}, {len(schema_json.get('tables', []))}, {dq(schema_json)}::jsonb) "
        f"RETURNING id;", capture=True)
    return int(rows[0]["id"])


def start_run(target_db: str) -> int:
    rows = pg(f"INSERT INTO autopilot.run (target_db) VALUES ({dq(target_db)}) RETURNING id;",
              capture=True)
    return int(rows[0]["id"])


def save_playbook(target_db: str, pb: dict, valid: bool, note: str, generated_by: str):
    pg(
        "INSERT INTO autopilot.playbook (target_db, playbook_key, title, kind, hypothesis, "
        "detection_sql, gross_metric, realization_factor, sizing_basis, severity_rules, "
        "recommended_action, generated_by, valid, validation_note) VALUES ("
        f"{dq(target_db)}, {dq(pb.get('id'))}, {dq(pb.get('title'))}, {dq(pb.get('kind','opportunity'))}, "
        f"{dq(pb.get('hypothesis'))}, {dq(pb.get('detection_sql'))}, {dq(pb.get('gross_metric'))}, "
        f"{float(pb.get('realization_factor',1.0))}, {dq(pb.get('basis'))}, "
        f"{dq(pb.get('severity', []))}::jsonb, {dq(pb.get('recommended_action'))}, "
        f"{dq(generated_by)}, {str(valid).lower()}, {dq(note)});")


def save_findings(run_id: int, findings: list[dict]):
    for f in findings:
        pg(
            "INSERT INTO autopilot.finding (run_id, playbook_key, title, kind, severity, headline, "
            "gross_value, opportunity_value, basis, recommended_action, metrics, receipt_sql) VALUES ("
            f"{run_id}, {dq(f['id'])}, {dq(f['title'])}, {dq(f['kind'])}, {dq(f['severity'])}, "
            f"{dq(f['headline'])}, {f['gross_value']}, {f['opportunity_value']}, {dq(f['basis'])}, "
            f"{dq(f['recommended_action'])}, {dq(f['metrics'])}::jsonb, {dq(f['receipt_sql'])});")


def finish_run(run_id: int, status: str, gen: int, valid: int,
               opp: float, risk: float, memo_md: str):
    pg(
        "UPDATE autopilot.run SET finished_at = now(), "
        f"status = {dq(status)}, playbooks_generated = {gen}, playbooks_valid = {valid}, "
        f"total_opportunity = {opp:.2f}, total_at_risk = {risk:.2f}, memo_md = {dq(memo_md)} "
        f"WHERE id = {run_id};")


def cache_latest(payload: dict):
    redis_set("argus:latest", json.dumps(payload))
