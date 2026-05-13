-- ----------------------------------------------------------------------------
-- v0.3 — Knowledge Graph (Argus's growing brain)
--
-- Three tables: nodes, edges, evidence. Every node and every edge must point
-- to at least one query receipt (the trust spine — same principle as memos in
-- docs/AGENT_LOOPS.md L3 Critic).
--
-- Requires the pgvector and pg_trgm extensions. The container image must be
-- pgvector/pgvector:pg16 (see docker-compose.yml).
--
-- Idempotent. Safe to re-run.
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----- kg_node ---------------------------------------------------------------
-- Concrete entities discovered from data: customers, employees, deals,
-- vendors, products, invoices, ...
--
-- `canonical_key` is the strong identifier (email, phone, vat_id) when one
-- exists. When it doesn't, the resolver writes the name + falls back to
-- trigram + embedding matching.
--
-- `evidence_count` is first-class: an edge is not "true or false" but
-- "we have seen this in N rows over M months". The decay job uses this.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kg_node (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL DEFAULT 'default',         -- placeholder until multi-tenant lands
  type            TEXT NOT NULL,                           -- 'customer' | 'employee' | 'deal' | ...
  name            TEXT NOT NULL,
  canonical_key   TEXT,                                    -- email | phone | vat_id when known
  props           JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding       vector(1536),                            -- nullable until extractor backfills
  confidence      REAL NOT NULL DEFAULT 1.0,
  evidence_count  INTEGER NOT NULL DEFAULT 1,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  decayed_at      TIMESTAMPTZ
);

-- One entity per (tenant, type, canonical_key) — but only when canonical_key
-- is present. Without a strong key we accept duplicates and let the resolver
-- merge them later.
CREATE UNIQUE INDEX IF NOT EXISTS kg_node_canonical_uniq
  ON kg_node (tenant_id, type, canonical_key)
  WHERE canonical_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS kg_node_tenant_type_idx
  ON kg_node (tenant_id, type);

CREATE INDEX IF NOT EXISTS kg_node_name_trgm_idx
  ON kg_node USING GIN (name gin_trgm_ops);

-- IVFFlat needs a tuned lists value; 100 is fine up to ~100k rows. Re-tune
-- with REINDEX when growth justifies it.
CREATE INDEX IF NOT EXISTS kg_node_embedding_idx
  ON kg_node USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ----- kg_edge ---------------------------------------------------------------
-- Relationships between nodes. `relation` is free-text discovered or seeded
-- (works_at, owns, paid_by, ships_to, manages, ...). Confidence and
-- evidence_count behave the same as kg_node.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kg_edge (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL DEFAULT 'default',
  src             BIGINT NOT NULL REFERENCES kg_node(id) ON DELETE CASCADE,
  dst             BIGINT NOT NULL REFERENCES kg_node(id) ON DELETE CASCADE,
  relation        TEXT NOT NULL,
  props           JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence      REAL NOT NULL DEFAULT 1.0,
  evidence_count  INTEGER NOT NULL DEFAULT 1,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  decayed_at      TIMESTAMPTZ,
  CHECK (src <> dst)
);

CREATE UNIQUE INDEX IF NOT EXISTS kg_edge_unique_idx
  ON kg_edge (tenant_id, src, dst, relation);

CREATE INDEX IF NOT EXISTS kg_edge_src_idx ON kg_edge (src);
CREATE INDEX IF NOT EXISTS kg_edge_dst_idx ON kg_edge (dst);
CREATE INDEX IF NOT EXISTS kg_edge_relation_idx ON kg_edge (tenant_id, relation);

-- ----- kg_evidence -----------------------------------------------------------
-- The trust spine. Every node-creation and edge-creation must persist at least
-- one row here pointing back to a `query_receipt` (the SQL that proved it).
--
-- For v0.1 the receipt-id is opaque; once query_receipts ships as its own
-- table (per docs/ARCHITECTURE_TARGET.md §1 Data Plane), this becomes a real
-- FK. The CHECK ensures evidence is attached to exactly one of node|edge.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kg_evidence (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL DEFAULT 'default',
  node_id         BIGINT REFERENCES kg_node(id) ON DELETE CASCADE,
  edge_id         BIGINT REFERENCES kg_edge(id) ON DELETE CASCADE,
  receipt_id      TEXT NOT NULL,                           -- opaque pointer; will FK later
  extractor       TEXT NOT NULL,                           -- 'schema_mapper' | 'llm_extractor' | 'inferer'
  confidence      REAL NOT NULL DEFAULT 1.0,
  raw_row_ref     JSONB,                                   -- {table, pk, col} of the source cell
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((node_id IS NULL) <> (edge_id IS NULL))           -- exactly one of node|edge
);

CREATE INDEX IF NOT EXISTS kg_evidence_node_idx ON kg_evidence (node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kg_evidence_edge_idx ON kg_evidence (edge_id) WHERE edge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kg_evidence_receipt_idx ON kg_evidence (receipt_id);

-- ----- helpful comments ------------------------------------------------------
COMMENT ON TABLE  kg_node     IS 'Concrete entities discovered from tenant data. See docs/KNOWLEDGE_GRAPH.md.';
COMMENT ON TABLE  kg_edge     IS 'Relationships between entities. Direction src -> dst. Confidence decays per outcome feedback.';
COMMENT ON TABLE  kg_evidence IS 'The trust spine: every node/edge must point to at least one row here, citing a query receipt.';
COMMENT ON COLUMN kg_node.evidence_count IS 'Count of distinct source rows / receipts. First-class: used by decay job and viz weighting.';
COMMENT ON COLUMN kg_edge.evidence_count IS 'Count of distinct source rows / receipts attesting this edge.';
