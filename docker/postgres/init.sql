-- ----------------------------------------------------------------------------
-- Argus initial schema
-- Runs once on first boot of the postgres container.
-- Idempotent: every CREATE uses IF NOT EXISTS.
-- App migrations (v0.2+) take over from here.
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----- events -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  event_id        TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  source          JSONB NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  subject_type    TEXT,
  subject_id      TEXT,
  payload         JSONB NOT NULL,
  tags            JSONB
);

CREATE INDEX IF NOT EXISTS events_type_occurred_idx
  ON events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_subject_idx
  ON events (subject_type, subject_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_tags_gin
  ON events USING GIN (tags);

-- ----- connectors -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connectors (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  name            TEXT NOT NULL,
  config          JSONB NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  -- v0.2.1: outcome of the most recent *manual* "Test now" click. Kept apart
  -- from last_sync_at / last_error which are owned by the polling loop.
  last_test_at    TIMESTAMPTZ,
  last_test_ok    BOOLEAN,
  last_test_error TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent upgrade for installs that already have the older shape.
ALTER TABLE connectors
  ADD COLUMN IF NOT EXISTS last_test_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_ok    BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_test_error TEXT;

CREATE TABLE IF NOT EXISTS connector_cursors (
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  mapping_key  TEXT NOT NULL,
  cursor_value TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connector_id, mapping_key)
);

-- ----- investigators ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS investigators (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  definition        JSONB NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  severity_threshold TEXT NOT NULL DEFAULT 'medium',
  provider          TEXT,
  source            TEXT NOT NULL DEFAULT 'builtin',  -- 'builtin' | 'user'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investigations (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  investigator_id   TEXT NOT NULL REFERENCES investigators(id) ON DELETE CASCADE,
  triggered_by      JSONB,                -- { kind: 'event' | 'schedule', event_id?, ... }
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'running',  -- running | succeeded | failed
  error             TEXT,
  provider          TEXT,
  model             TEXT,
  tokens_input      INTEGER,
  tokens_output     INTEGER
);

CREATE INDEX IF NOT EXISTS investigations_inv_started_idx
  ON investigations (investigator_id, started_at DESC);

-- ----- findings ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS findings (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  investigation_id   TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  investigator_id    TEXT NOT NULL,
  severity           TEXT NOT NULL,        -- none | low | medium | high | critical
  summary            TEXT NOT NULL,
  evidence           JSONB NOT NULL,       -- [{ event_id, reason }, ...]
  recommendation     TEXT,
  impact_estimate    JSONB,                -- { currency, amount, basis } | null
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS findings_severity_created_idx
  ON findings (severity, created_at DESC);

CREATE INDEX IF NOT EXISTS findings_investigator_created_idx
  ON findings (investigator_id, created_at DESC);

-- ----- alert channels & dispatch ----------------------------------------------
CREATE TABLE IF NOT EXISTS alert_channels (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,    -- slack | discord | email | webhook
  name        TEXT NOT NULL,
  config      JSONB NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  finding_id    TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  channel_id    TEXT NOT NULL REFERENCES alert_channels(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alerts_status_idx ON alerts (status, created_at);

-- ----- bootstrap default alert channel ---------------------------------------
INSERT INTO alert_channels (id, type, name, config, enabled)
VALUES (
  'slack:ops',
  'slack',
  'Default Slack channel',
  jsonb_build_object('webhook_url_env', 'ARGUS_SLACK_WEBHOOK_URL'),
  true
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- v0.2 — multi-agent pipeline schema
-- Inlined from docker/postgres/migrations/0002_agents.sql so first boot lands
-- the full v0.2 schema. The standalone file is the source of truth used by
-- apps/api/scripts/migrate-v02.ts for upgrades on existing installs.
-- ============================================================================

-- ----- agents -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  description          TEXT,
  provider             TEXT NOT NULL,
  model                TEXT NOT NULL,
  system_prompt        TEXT NOT NULL,
  user_prompt_template TEXT,
  output_schema_kind   TEXT NOT NULL,                          -- 'text' | 'analysis' | 'finding'
  source               TEXT NOT NULL DEFAULT 'user',           -- 'builtin' | 'user'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----- pipeline_agents --------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_agents (
  investigator_id TEXT NOT NULL REFERENCES investigators(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  position        SMALLINT NOT NULL,
  reads_from      JSONB NOT NULL DEFAULT '"all"'::jsonb,
  PRIMARY KEY (investigator_id, position),
  UNIQUE (investigator_id, agent_id)
);

CREATE INDEX IF NOT EXISTS pipeline_agents_inv_idx
  ON pipeline_agents (investigator_id, position);

-- ----- agent_runs -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
  id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  investigation_id       TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  agent_id               TEXT NOT NULL,
  position               SMALLINT NOT NULL,
  status                 TEXT NOT NULL,                        -- running | succeeded | failed
  started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at            TIMESTAMPTZ,
  provider               TEXT NOT NULL,
  model                  TEXT NOT NULL,
  system_prompt_rendered TEXT NOT NULL,
  user_prompt_rendered   TEXT NOT NULL,
  output_json            JSONB,
  output_text            TEXT,
  tokens_input           INTEGER,
  tokens_output          INTEGER,
  error                  TEXT
);

CREATE INDEX IF NOT EXISTS agent_runs_invest_idx
  ON agent_runs (investigation_id, position);

-- ----- investigators schema-version column -----------------------------------
ALTER TABLE investigators
  ADD COLUMN IF NOT EXISTS definition_schema_version SMALLINT NOT NULL DEFAULT 1;

-- ============================================================================
-- v0.2.2 — LLM provider credentials in the DB (replaces env-only mode)
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_credentials (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  api_key_enc   TEXT NOT NULL,
  default_model TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT,
  last_test_at  TIMESTAMPTZ,
  last_test_ok  BOOLEAN,
  last_test_error TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_credentials_provider_idx
  ON llm_credentials (provider, is_default DESC);

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS credential_id TEXT
    REFERENCES llm_credentials(id) ON DELETE SET NULL;

-- ============================================================================
-- v0.2.3 — connector schema crawl + LLM-generated description
-- ============================================================================

CREATE TABLE IF NOT EXISTS connector_schemas (
  connector_id   TEXT PRIMARY KEY REFERENCES connectors(id) ON DELETE CASCADE,
  schema_json    JSONB NOT NULL,
  description    TEXT,
  description_at TIMESTAMPTZ,
  description_credential_id TEXT REFERENCES llm_credentials(id) ON DELETE SET NULL,
  crawled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  crawl_error    TEXT
);
