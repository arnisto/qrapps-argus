-- Argus Autopilot — persistence schema (lives in the `argus` control-plane DB).
-- Everything the autonomous loop learns is stored here, not in files.

CREATE SCHEMA IF NOT EXISTS autopilot;

-- A snapshot of a target DB's structure, as understood by the mapper.
CREATE TABLE IF NOT EXISTS autopilot.schema_map (
  id          BIGSERIAL PRIMARY KEY,
  target_db   TEXT NOT NULL,
  mapped_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  table_count INT,
  schema_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS schema_map_db_idx ON autopilot.schema_map (target_db, mapped_at DESC);

-- A playbook the LLM generated (or a human seeded). Versioned by run.
CREATE TABLE IF NOT EXISTS autopilot.playbook (
  id                 BIGSERIAL PRIMARY KEY,
  target_db          TEXT NOT NULL,
  playbook_key       TEXT NOT NULL,         -- stable slug, e.g. 'lost_parcel_exposure'
  title              TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'opportunity',
  hypothesis         TEXT,
  detection_sql      TEXT NOT NULL,
  gross_metric       TEXT NOT NULL,
  realization_factor REAL NOT NULL DEFAULT 1.0,
  sizing_basis       TEXT,
  severity_rules     JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_action TEXT,
  generated_by       TEXT,                  -- 'gemini/gemini-2.5-flash' | 'seed'
  valid              BOOLEAN NOT NULL DEFAULT false,
  validation_note    TEXT,                  -- error or 'ok' or fix history
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS playbook_db_idx ON autopilot.playbook (target_db, created_at DESC);

-- One execution of the whole loop.
CREATE TABLE IF NOT EXISTS autopilot.run (
  id               BIGSERIAL PRIMARY KEY,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  target_db        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'running',  -- running|succeeded|failed
  playbooks_generated INT DEFAULT 0,
  playbooks_valid     INT DEFAULT 0,
  total_opportunity   NUMERIC(16,2) DEFAULT 0,
  total_at_risk       NUMERIC(16,2) DEFAULT 0,
  memo_md          TEXT
);

-- A sized finding produced by running a valid playbook in a run.
CREATE TABLE IF NOT EXISTS autopilot.finding (
  id                BIGSERIAL PRIMARY KEY,
  run_id            BIGINT NOT NULL REFERENCES autopilot.run(id) ON DELETE CASCADE,
  playbook_key      TEXT NOT NULL,
  title             TEXT NOT NULL,
  kind              TEXT,
  severity          TEXT,
  headline          TEXT,
  gross_value       NUMERIC(16,2),
  opportunity_value NUMERIC(16,2),
  basis             TEXT,
  recommended_action TEXT,
  metrics           JSONB,
  receipt_sql       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finding_run_idx ON autopilot.finding (run_id);
CREATE INDEX IF NOT EXISTS finding_sev_idx ON autopilot.finding (severity, opportunity_value DESC);

-- A target database Argus analyses. Managed from the Connectors UI; the daily
-- run (--all-enabled) analyses every enabled connector.
CREATE TABLE IF NOT EXISTS autopilot.connector (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  dbname      TEXT NOT NULL UNIQUE,
  pg_user     TEXT NOT NULL DEFAULT 'mehdi',
  kind        TEXT NOT NULL DEFAULT 'postgres',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  last_status TEXT,
  last_tested TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
