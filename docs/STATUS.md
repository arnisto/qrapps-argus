# Status — 2026-05-13

Where the project stands at end of day. Updated whenever a major chunk lands.

## TL;DR

The strategic and architectural foundation is in place (5 design docs). The Knowledge Graph track is live: issue #1 filed with the full design proposal, PR #2 open with the walking-skeleton scaffolding. Implementation hasn't started — next concrete step is the Phase-1 entity extractor (P1 PR).

## What landed in `main`

| Commit | What |
|---|---|
| `ff69b42` | Initial commit — entire monorepo (191 files): pnpm/turbo scaffolding, Docker Compose, CI workflow, 9 design docs |
| `967c6cd` | `docs/AGENT_LOOPS.md` — four-loop agent runtime, auto-correction taxonomy, budgeting |

## What's in flight

### PR #2 — KG walking-skeleton

- **Branch**: `kg/scaffolding`
- **Status**: open, awaiting review
- **Diff**: 13 files, +785 insertions
- **URL**: https://github.com/arnisto/qrapps-argus/pull/2

Contains: schema migration `0006_knowledge_graph.sql`, `CdcStrategy` interface + `PollDetector` + `PgLogicalDetector` stub, brain viz page (Cytoscape concentric), mock `/api/kg/neighborhood` endpoint, decisions doc.

### Issue #1 — Living Knowledge Graph

- **Status**: open, design phase
- **URL**: https://github.com/arnisto/qrapps-argus/issues/1
- Full design proposal with 10-section implementation plan. PR #2 implements P0.

## Decisions locked this session

| Decision | Choice | Recorded in |
|---|---|---|
| Wedge / GTM | Weekly board-grade exec memo with sized opportunities. Not "chat with DB". | [`STRATEGY.md`](./STRATEGY.md) |
| Architecture | Three planes (Control / Data / Inference). Tenant data only lives in Data Plane. | [`ARCHITECTURE_TARGET.md`](./ARCHITECTURE_TARGET.md) |
| Agent runtime | Four nested loops (L1 query, L2 playbook, L3 portfolio, L4 meta). DB is the truth oracle. | [`AGENT_LOOPS.md`](./AGENT_LOOPS.md) |
| Graph + vector store | Postgres 16 + pgvector + pg_trgm. No Neo4j. | [`KNOWLEDGE_GRAPH.md`](./KNOWLEDGE_GRAPH.md) |
| CDC strategy | `poll_updated_at` default, `pg_logical_native` upgrade, Debezium Server reserved for Phase 2, Kafka deferred to Year 2 | [`KNOWLEDGE_GRAPH.md`](./KNOWLEDGE_GRAPH.md) |
| Visualization | Cytoscape.js concentric (radial), not force-directed | [`KNOWLEDGE_GRAPH.md`](./KNOWLEDGE_GRAPH.md) |
| Docker image | `pgvector/pgvector:pg16` | `docker-compose.yml` |

## Validated against real data

Connected to host Postgres (`intigo_finance` / `intigo` / `intigo_logistics`). Confirmed:

- Schema matches what `ARCHITECTURE_TARGET.md` predicted: `finance_expediteurinvoice`, `comptabilite_bill{2022,2023,2024}`, `comptabilite_reconstructedparcel`, `finance_cod_in`/`finance_cod_out`.
- Total transaction volume (COD GMV) across all years: **~337 milliards TND** (Tunisian colloquial; 1 milliard ≈ 1 M TND). Year-by-year breakdown in conversation log.
- Methodology gotchas surfaced: `net_amount` is TTC (gross of VAT, 7 % embedded), case-sensitive column names (`amount_HT`), 4-month data gap Jan–Apr 2025 between `comptabilite_bill2024` and `finance_cod_in`.

These findings will become the first three playbooks in P1.

## Open decisions (block P1)

From [`KNOWLEDGE_GRAPH.md §Open questions`](./KNOWLEDGE_GRAPH.md):

1. **Embedding model** — OpenAI `text-embedding-3-small` (1536d) vs Ollama `nomic-embed-text` self-hosted?
2. **Seed ontology** — adjust the proposed 12 types before P1?
3. **Drip batching** — confirm 100 events/batch + 10 s debounce as starting defaults?
4. **CEO-facing URL** — `/brain` (dev) → `/intelligence/map` (production)?

## Next concrete step

**P1 PR** — Phase-1 entity extractor for the Postgres connector:

- `packages/connectors/src/postgres/extract.ts`: schema-mapper + row-extractor calling an LLM (Claude Sonnet) on the top ~50 tables × 500 rows each
- Seed ontology in `packages/investigators/templates/ontology/seed.yaml`
- Cold-Start Spike worker (`apps/workers/src/workers/kg-coldstart.ts`)
- Drip enricher (`apps/workers/src/workers/kg-drip.ts`) consuming `ChangeEvent` from the CDC layer
- First Postgres connector run end-to-end against `intigo_finance` → populated `kg_node`/`kg_edge`/`kg_evidence`

Target: PR #3 open within next session.

## Repo housekeeping

- Active branch on this machine: `kg/scaffolding`
- Author email pinned to `lamjed.gaidi070@gmail.com` at the repo level (so commits attribute to `arnisto` profile on GitHub once 070@ is verified there)
- No Argus containers are currently running — never started `docker compose up` this session
