-- Per-env connector for the knowledge-layer product.
--
-- Lives at `public.env_connectors` (NOT just `connectors`, because the
-- v0.2 observability product still owns a `connectors` table — different
-- shape, different lifecycle). The `kind` enum tells the agent which
-- family the row belongs to; `subtype` names the specific integration
-- (postgres, slack, notion, …). Per-kind config + secret shape is
-- enforced at the Fastify boundary by a Zod discriminated union — the
-- DB just stores the bytes.

DO $$ BEGIN
  CREATE TYPE env_connector_kind AS ENUM ('db', 'channel', 'tool', 'doc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS env_connectors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id            UUID NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  kind              env_connector_kind NOT NULL,
  subtype           TEXT NOT NULL,                       -- 'postgres' | 'slack' | 'notion' | 'web_search' | …
  name              TEXT NOT NULL,                       -- operator's nickname e.g. 'acme-prod-readonly'
  config            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- non-secret connection details
  secret_ct         BYTEA,                                -- AES-GCM-encrypted secret blob
  secret_iv         BYTEA,
  scope             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- allow/deny lists, capabilities flags
  status            TEXT NOT NULL DEFAULT 'connected',   -- 'connected' | 'error' | 'crawling' | 'disabled'
  status_detail     TEXT,                                 -- last error / progress note
  last_synced_at    TIMESTAMPTZ,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (env_id, name)
);

CREATE INDEX IF NOT EXISTS env_connectors_env_kind_idx    ON env_connectors(env_id, kind);
CREATE INDEX IF NOT EXISTS env_connectors_env_subtype_idx ON env_connectors(env_id, subtype);
