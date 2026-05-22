# Argus ROI Engine — MVP

The smallest thing that proves the Argus thesis: connect to a real operational
Postgres, run a catalog of **opportunity playbooks**, **size every finding in money**,
and emit a **board-grade memo** with prioritized actions — every number traceable
to the SQL that produced it.

This is the v0 runner from [`docs/STRATEGY.md`](../../docs/STRATEGY.md) and the
deterministic-sizing discipline from [`docs/AGENT_LOOPS.md`](../../docs/AGENT_LOOPS.md):

> The database is the truth oracle. The LLM proposes; the database disposes.
> Severity & sizing are deterministic. Every number ships with its receipt SQL.

## Run it

```bash
cd mvp/argus_roi
python3 engine.py                          # print memo to stdout
python3 engine.py --out memo.md            # write the memo
python3 engine.py --json findings.json     # structured findings
```

No external deps beyond PyYAML — queries run through the `psql` CLI using local
peer auth. Override the DB user with `ARGUS_PG_USER=...`.

## What it found on the live Intigo DB (2026-05-22)

| Playbook | Realizable value | Severity |
|---|--:|---|
| Lost-Parcel Value Exposure | 204,610 TND | 🔴 critical |
| Dormant High-Value Shipper Reactivation | 1,026,515 TND | 🟠 high |
| Revenue Concentration Risk (top 10) | 542,675 TND at risk | 🟡 medium |
| Ghost-Employee Financial Exposure | 34,521 TND | 🟠 high |
| Driver COD Shortage Recovery | 24,938 TND | 🟡 medium |
| **TOTAL** | **~1.29M TND realizable + 0.54M at risk** | |

## How it works

```
playbooks/*.yaml  ──►  engine.py  ──►  executive memo (markdown)
   │                      │
   │                      ├─ run detection_sql via psql (truth oracle)
   │                      ├─ size: gross × realization_factor  (deterministic)
   │                      ├─ score severity (rule-based)
   │                      └─ compose memo + attach receipt SQL
```

### A playbook (YAML)

```yaml
id: lost_parcel_exposure
title: Lost-Parcel Value Exposure
kind: recovery            # opportunity | risk | recovery
database: intigo
detection_sql: |          # MUST return one summary row of named metrics
  SELECT COUNT(*) AS lost_parcels, SUM(price)::numeric(14,2) AS lost_value_tnd
  FROM logistics_parcel WHERE status IN (9004,9005,9006);
headline: "{lost_parcels} parcels lost = {lost_value_tnd} uncollected."
sizing:
  gross_metric: lost_value_tnd
  realization_factor: 0.15      # conservative % of gross that's actually realizable
  basis: "Of {gross}, {factor_pct} realizable = {opportunity}."
severity:
  - { if: "lost_value_tnd > 1000000", level: critical }
  - { if: "lost_value_tnd > 200000",  level: high }
recommended_action: "Stand up a lost-parcel recovery desk ..."
```

Add a playbook = drop a new YAML file. No code change.

## Realization factors (the ROI assumptions, stated openly)

| Playbook | Factor | Why |
|---|--:|---|
| Lost parcels | 15% | insurance claims + driver liability on recent cases only |
| Ghost-employee exposure | 60% | documented loan agreements, recoverable if pursued promptly |
| COD shortage | 80% | payroll deduction — cleanest possible recovery channel |
| Dormant shippers | 5% | win-back conversion on proven lifetime value |
| Concentration risk | 100% | defensive — full fee revenue at risk if #1 churns |

These are deliberately conservative and **fully visible** — adjust them in the
YAML and the memo recomputes. The gross numbers underneath are pure SQL truth.

## Roadmap to productionize

1. Swap `psql` subprocess → `psycopg` connection pool with read-only role + statement timeout.
2. Move playbooks into the semantic layer so SQL is written against canonical
   concepts (`Revenue`, `Shipper`, `Parcel`) instead of raw table names — see
   [`docs/ARCHITECTURE_TARGET.md`](../../docs/ARCHITECTURE_TARGET.md).
3. Add the Critic pass (re-execute every cited number; reject mismatches) per
   [`docs/AGENT_LOOPS.md`](../../docs/AGENT_LOOPS.md) L3.
4. LLM Composer for narrative polish — prose only, never math.
5. Schedule weekly; deliver to Slack/email; track which findings the CEO acts on
   (the L4 meta-loop).
