# Knowledge Graph — locked decisions and scaffolding

> Captured 2026-05-13. Implements [issue #1](https://github.com/arnisto/qrapps-argus/issues/1) (the Living Knowledge Graph). This document records the technology choices and the walking-skeleton scaffolding shipped in PR #2.
>
> Companion to [`ARCHITECTURE_TARGET.md`](./ARCHITECTURE_TARGET.md), [`AGENT_LOOPS.md`](./AGENT_LOOPS.md), [`STRATEGY.md`](./STRATEGY.md).

---

## Locked decisions

| Question | Choice | Rejected alternatives |
|---|---|---|
| Graph + vector store | **Postgres 16 + `pgvector` + `pg_trgm`** | Neo4j (separate service, no relational joins), Memgraph, Qdrant (extra container) |
| Cypher syntax | **Skip for v1.** Add `Apache AGE` only if a tenant asks. | Force-add now |
| CDC (Phase 1) | **`pg_logical_replication`** (Node TS lib, ~500 LOC). Behind a `CdcStrategy` switch with **polling as default**. | Debezium + Kafka (overkill for one consumer; defer to Year 2) |
| CDC (Phase 2) | **Debezium Server** with Redis-Streams sink — for tenants who need MySQL/Mongo CDC | Debezium + full Kafka cluster |
| Multi-tenancy | RLS by `tenant_id` in pooled mode (Starter), dedicated DB per tenant in Silo / Enterprise | Per-tenant Postgres schemas (harder to migrate) |
| Visualization | **Cytoscape.js**, concentric layout, click-to-recenter, edge → SQL receipt panel | react-flow (radial needs custom math), sigma.js (overkill), d3-force (force-directed) |
| Docker image | **`pgvector/pgvector:pg16`** | Build a custom image; install extensions on first boot |

The single overriding rule, from [`AGENT_LOOPS.md`](./AGENT_LOOPS.md): **every node and every edge cites a query receipt.** If you can't click a node and see the SQL that proved it exists, it doesn't belong in the graph.

---

## What ships in this scaffolding PR

A walking skeleton: every layer present, none of it deep, all of it connected.

| File | What it is |
|---|---|
| `docker-compose.yml` | Postgres image swapped to `pgvector/pgvector:pg16`. Migration 0006 mounted alongside `init.sql`. |
| `docker/postgres/migrations/0006_knowledge_graph.sql` | The three tables: `kg_node`, `kg_edge`, `kg_evidence`. Extensions, indexes, comments. |
| `packages/connectors/src/cdc/types.ts` | `CdcStrategy` union + `ChangeDetector` interface. Five strategy kinds declared; two implemented. |
| `packages/connectors/src/cdc/poll.ts` | `PollDetector` — the default, wraps the existing cursor-based polling already in `packages/connectors/src/postgres/`. |
| `packages/connectors/src/cdc/pg-logical.ts` | `PgLogicalDetector` — stub. Phase 1 implementation lands in the next PR. |
| `packages/connectors/src/cdc/index.ts` | `createDetector()` factory. The only thing the runtime imports. |
| `apps/dashboard/src/app/brain/page.tsx` | Cytoscape.js concentric radial view. Reads from `/api/kg/neighborhood`. |
| `apps/dashboard/src/app/api/kg/neighborhood/route.ts` | Mock endpoint returning a 7-node sample so the brain page is testable end-to-end now. |

### Required `pnpm install` after pulling this PR

New deps added to two manifests:

- `packages/connectors/package.json`: `pg-logical-replication ^2.0.5`
- `apps/dashboard/package.json`: `cytoscape ^3.30`, `react-cytoscapejs ^2`, plus `@types/cytoscape` and `@types/react-cytoscapejs`

Run from the repo root:

```bash
pnpm install
```

---

## CDC strategy switch — how to upgrade a tenant

The connector config holds a `CdcStrategy` per tenant. The factory in `packages/connectors/src/cdc/index.ts` dispatches.

### Default (works on any Postgres):

```yaml
cdc:
  kind: poll_updated_at
  cursor_col: updated_at
  interval_ms: 30000
```

### Upgrade to logical replication (full fidelity, includes DELETEs):

One-time setup on the **tenant's** source database (requires `REPLICATION` role, or admin):

```sql
CREATE PUBLICATION argus_pub FOR ALL TABLES;
SELECT pg_create_logical_replication_slot('argus_slot', 'pgoutput');
```

Then switch the connector config:

```yaml
cdc:
  kind: pg_logical_native
  publication: argus_pub
  slot: argus_slot
```

The runtime never imports a detector directly — only `createDetector()` from `cdc/index.ts`. Adding a new strategy is one new variant + one new file + one branch in the factory.

---

## The brain viz — interactions

Open `http://localhost:3000/brain` after `docker compose up`. The page:

- Renders a concentric radial layout (ring 0 = focus, ring 1 = direct edges, ring 2 = 2-hop).
- Node size = `log₂(evidence_count + 1)` — confidence at a glance.
- Edge thickness = stored `thickness` (already weighted by confidence × recency upstream).
- **Click any node** → that node becomes the new focus, the layout recenters.
- **Click any edge** → side panel slides in with relation, confidence, and a placeholder for SQL receipts (wired in the Phase-2 PR).
- Click empty canvas → close panel.

Force-directed views are deliberately not used here. They're unreadable on real business graphs. Radial concentric is the right shape for a CEO navigating *"who is connected to Acme Corp?"*

---

## Phased delivery (matches [issue #1 §9](https://github.com/arnisto/qrapps-argus/issues/1))

| Phase | Scope | Status |
|---|---|---|
| **P0 — this PR** | Schema migration, CDC interface, brain viz scaffolding, mock endpoint | ✅ shipping in PR #2 |
| **P1** | Schema mapper + LLM row extractor for the Postgres connector, seeded ontology | next PR |
| **P2** | 3-stage resolver (exact → trigram → embedding), Cold-Start Spike vs Drip orchestration | follow-up |
| **P3** | Relationship inferer (transitive only first) + "neuron born" delivery channel | follow-up |
| **P4** | Outcome-weighted decay + edge receipt panel wired to real query receipts | follow-up |
| **P5** | Multi-hop GraphRAG integrated into the L3 Composer (`AGENT_LOOPS.md`) | follow-up |
| **P6** | Cross-tenant anonymized type harvesting (Year-2 moat from `STRATEGY.md §9`) | later |

---

## Open questions (decide before P1)

1. **Embedding model**: which provider for `kg_node.embedding(vector(1536))`? Default to OpenAI `text-embedding-3-small` (1536 dims, cheap)? Or self-hosted `nomic-embed-text` via Ollama? The schema is sized for 1536; changing dims later means re-indexing.
2. **Seed ontology**: 12 types proposed in issue #1 (`customer`, `employee`, `deal`, `vendor`, `product`, `invoice`, `parcel`, `shipment`, `payment`, `address`, `account`, `document`). Adjust before P1.
3. **Drip batching**: how many change events per drip-enrichment job? Recommend 100/batch with 10s debounce. Tune after first real workload.
4. **CEO-facing route**: `/brain` is the dev path. Final URL — `/intelligence/map` to fit the existing dashboard naming?
