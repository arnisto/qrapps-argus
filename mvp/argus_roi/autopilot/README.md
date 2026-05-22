# Argus Autopilot — the autonomous loop

Not a fixed report. A **mind**: it maps your database, *invents* the opportunity
playbooks itself with an LLM, self-corrects the SQL against the live DB, sizes
every finding in money, and stores everything in Postgres + Redis. A daily cron
runs the whole thing with zero human input.

```
   map  →  generate  →  validate (self-correct)  →  size  →  persist  →  compose
    │          │              │                       │         │           │
 mapper.py  generator.py  validator.py            (sizing)   store.py    autopilot.py
            (LLM = mind)  (L1 query loop)                   PG + Redis   (+ LLM memo)
```

## Run it

```bash
cd mvp/argus_roi/autopilot
python3 autopilot.py --target intigo --n 8        # full autonomous run
python3 autopilot.py --target intigo --print-memo # also print the memo
```

It's already scheduled — `cron.sh` runs daily at **07:00** (installed via `crontab`).
Check it with `crontab -l`. Logs roll into `autopilot/logs/cron.log`.

## What each piece does

| File | Role |
|---|---|
| `mapper.py` | Introspects the target Postgres → compact schema map (tables, columns, FKs, sampled status values). Read-only, uses row-count estimates so it's instant on huge tables. |
| `generator.py` | **The mind.** Sends the schema map to the LLM and gets back N opportunity playbooks (hypothesis + SQL + sizing + severity + action). |
| `validator.py` | **The L1 self-correcting loop.** Runs each playbook's SQL in a `READ ONLY` transaction with a 30s timeout. On error, feeds the DB error + schema back to the LLM to fix — up to 3 retries. Rejects writes. A playbook ships only if it returns a verifiable summary row. |
| `store.py` | Persistence. Durable → `argus` Postgres (`autopilot.*` tables). Hot cache → Redis key `argus:latest`. **No result files.** |
| `autopilot.py` | Orchestrator. Ties the loop together, sizes findings, composes the memo (deterministic numbers + LLM narrative), persists. |
| `cron.sh` | The daily entrypoint cron calls. |

## Where the data lives (not in files)

**Postgres** (`argus` DB, schema `autopilot`):

| Table | Holds |
|---|---|
| `schema_map` | every DB snapshot the mapper took |
| `playbook` | every LLM-generated playbook (valid + invalid, with the fix history) |
| `run` | each loop execution + the composed memo |
| `finding` | every sized finding, with metrics + receipt SQL |

**Redis** (`argus:latest`): the most recent run's summary + memo, for instant dashboard reads.

```bash
# read the latest result straight from Redis
docker exec argus-redis redis-cli get argus:latest | python3 -m json.tool

# query historical findings from Postgres
psql postgresql://argus:argus@localhost:5434/argus \
  -c "SELECT title, severity, opportunity_value FROM autopilot.finding
      WHERE run_id=(SELECT max(id) FROM autopilot.run) ORDER BY opportunity_value DESC;"
```

## Safety

- All target-DB access is read-only: `BEGIN READ ONLY` + 30s `statement_timeout`,
  and a regex guard rejects any write/DDL keyword before execution.
- The LLM never computes money — it proposes SQL and writes prose. The database
  is the calculator (see [`docs/AGENT_LOOPS.md`](../../../docs/AGENT_LOOPS.md)).
- Invalid playbooks are stored too (with their error history) so the system can
  learn which patterns fail on this tenant — the seed of the L4 meta-loop.

## Honest limitations (today)

- LLM playbooks vary run-to-run; the same DB can surface different opportunities
  each day. Good for discovery, but pin the winners into a stable catalog over time.
- Realization factors are LLM-proposed estimates, not validated against Intigo's
  real recovery rates — treat sized values as directional until calibrated.
- No Critic pass yet (re-verify every number before shipping) — that's the next
  step from `docs/AGENT_LOOPS.md` L3.
