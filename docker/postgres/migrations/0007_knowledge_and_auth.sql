-- Knowledge-layer + auth schema for the real Argus product.
--
-- Adds: users / sessions / organizations / memberships, plus the
-- knowledge-layer tables (envs, providers, api keys, sources, chunks with
-- pgvector embeddings, requests). All in the `public` schema — the legacy
-- `autopilot.*` tables from the MVP Python era stay where they are until
-- we cut them over and drop the schema.
--
-- Idempotent — every CREATE uses IF NOT EXISTS / DO blocks so we can re-run
-- without harm.

CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive emails

-- ---------------------------------------------------------------------------
-- AUTH
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT      NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  name            TEXT,
  -- Soft fields for the welcome flow + admin oversight; nothing private.
  email_verified  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_superadmin   BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Bookkeeping
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

-- Opaque session tokens stored as random bytes, hashed at rest (sha256).
-- The cookie carries the plaintext token; we look up by the hash. Revocable
-- by deleting the row.
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      BYTEA       NOT NULL UNIQUE,
  -- Soft metadata so /settings/security can show "active sessions".
  user_agent      TEXT,
  ip_addr         INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- ORGANIZATIONS + MEMBERSHIPS
--
-- A user belongs to ≥1 organization. Envs (the "Speedo Delivery"-style
-- tenants) belong to an organization. Roles: owner > admin > member.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT        NOT NULL UNIQUE,   -- URL slug, immutable
  name            TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE org_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS memberships (
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            org_role    NOT NULL DEFAULT 'member',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS memberships_org_idx ON memberships(org_id);

-- Pending invitations — token mailed/copied; redeem -> creates membership.
CREATE TABLE IF NOT EXISTS invitations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           CITEXT      NOT NULL,
  role            org_role    NOT NULL DEFAULT 'member',
  token_hash      BYTEA       NOT NULL UNIQUE,
  invited_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS invitations_org_idx ON invitations(org_id);

-- ---------------------------------------------------------------------------
-- ENVIRONMENTS (the "Speedo Delivery"-style per-customer tenants)
--
-- An env is the unit of isolation: its own knowledge core, providers, API
-- keys, base URL /e/<slug>/v1. Slug is GLOBAL (because it goes in the URL),
-- but lifecycle is owned by an org.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS envs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug            TEXT        NOT NULL UNIQUE,   -- baked into URL + keys, immutable
  name            TEXT        NOT NULL,
  primary_model   TEXT        NOT NULL DEFAULT 'gemini-2.5-flash',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS envs_org_idx ON envs(org_id);

-- ---------------------------------------------------------------------------
-- PROVIDERS (per-env LLM provider credentials — encrypted at rest)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS providers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id          UUID        NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,                 -- 'gemini', 'openai', 'groq', 'ollama'
  base_url        TEXT,                                  -- null = provider default
  default_model   TEXT        NOT NULL,
  api_key_ct      BYTEA,                                 -- AES-GCM ciphertext (null for ollama)
  api_key_iv      BYTEA,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS providers_env_idx ON providers(env_id);

-- ---------------------------------------------------------------------------
-- API KEYS (Argus-issued, OpenAI-compatible, shown ONCE on creation)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id          UUID        NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  key_prefix      TEXT        NOT NULL,                  -- 'ak_live_abc…XYZ' (display only)
  key_hash        BYTEA       NOT NULL UNIQUE,           -- sha256(secret)
  rate_per_min    INTEGER     NOT NULL DEFAULT 60,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_env_idx ON api_keys(env_id);

-- ---------------------------------------------------------------------------
-- KNOWLEDGE: sources -> chunks (with embeddings)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sources (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id          UUID        NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL,                  -- 'file' | 'qa' | 'url'
  title           TEXT        NOT NULL,
  uri             TEXT,                                  -- original file path / URL
  bytes           INTEGER,
  authority       SMALLINT    NOT NULL DEFAULT 50,       -- 0..100, retrieval re-rank weight
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS sources_env_idx ON sources(env_id);

-- Embedding dim = 768 (gemini-embedding-001 with outputDimensionality=768).
-- HNSW index for cosine ANN.
CREATE TABLE IF NOT EXISTS chunks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id          UUID        NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  source_id       UUID        NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ord             INTEGER     NOT NULL,                  -- chunk index within source
  text            TEXT        NOT NULL,
  tokens          INTEGER     NOT NULL,
  embedding       vector(768),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_env_idx ON chunks(env_id);
CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks(source_id);
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- REQUEST LOG (per-env: tokens, latency, cost — powers billing + dashboards)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id          UUID        NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  api_key_id      UUID        REFERENCES api_keys(id) ON DELETE SET NULL,
  provider        TEXT        NOT NULL,
  model           TEXT        NOT NULL,
  prompt_tokens   INTEGER     NOT NULL DEFAULT 0,
  completion_tokens INTEGER   NOT NULL DEFAULT 0,
  total_tokens    INTEGER     NOT NULL DEFAULT 0,
  latency_ms      INTEGER     NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(12, 6) NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL,                  -- 'ok' | 'error' | 'no_grounded_context'
  retrieved_chunks INTEGER    NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS requests_env_idx ON requests(env_id);
CREATE INDEX IF NOT EXISTS requests_created_idx ON requests(created_at DESC);
