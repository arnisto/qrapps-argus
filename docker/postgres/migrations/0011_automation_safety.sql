-- M9.1 — Automation safety foundation.
--
-- Closes the outbound-leak surface that M8 left open. See
-- docs/ARCHITECTURE_AUTOMATION_SAFETY.md (full design, 15 sections).
--
-- This migration delivers:
--   1. Per-automation safety knobs (redaction_mode, region_pref,
--      output_retention_days, acknowledgements, plan_hash).
--   2. Per-provider region (so we can route EU-only renders).
--   3. column_classifications — what columns in connected DBs are
--      secret / pii / quasi-id / safe. Powers the redactor.
--   4. audit_events — append-only via Postgres triggers + role
--      privileges. ≥12mo retention class, separate from runs.
--
-- SaaS-pivot seed (per cofounder advisor 2026-06-25):
--   audit_events.org_id and column_classifications.org_id are NOT NULL
--   from day one — even though env_connectors / automations don't yet
--   denormalize org_id. The cost is one UUID column; the saving is not
--   having to backfill these tables when SaaS-spine work lands.
--
-- Idempotent. Every CREATE uses IF NOT EXISTS / DO blocks so re-runs
-- are safe.

-- ---------------------------------------------------------------------------
-- 1. Per-automation safety knobs
-- ---------------------------------------------------------------------------
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS redaction_mode TEXT NOT NULL DEFAULT 'mask-sensitive'
    CHECK (redaction_mode IN ('mask-sensitive', 'aggregate-only', 'raw-passthrough'));

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS provider_region_pref TEXT NOT NULL DEFAULT 'any'
    CHECK (provider_region_pref IN ('eu', 'us', 'any'));

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS output_retention_days INT NOT NULL DEFAULT 30
    CHECK (output_retention_days BETWEEN 1 AND 365);

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS acknowledgements JSONB NOT NULL DEFAULT '{}'::jsonb;

-- sha256(canonical(compiled_plan + redaction_mode + send.channel)).
-- Changes invalidate acknowledgements (operator must re-tick the 5 boxes).
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS plan_hash TEXT;

-- ---------------------------------------------------------------------------
-- 2. Provider region — needed for fail-clean region routing.
-- ---------------------------------------------------------------------------
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS region TEXT
    CHECK (region IN ('eu', 'us', 'other'));

-- ---------------------------------------------------------------------------
-- 3. column_classifications
-- ---------------------------------------------------------------------------
-- Per-column labels for connected db-kind env_connectors. Populated by:
--   (a) crawl-time sample at connector enable (source='auto')
--   (b) operator override via Privacy tab (source='operator')
--
-- Lives in its own table (not JSONB on env_connectors) so the redactor's
-- hot path is `WHERE connector_id = $1 AND label = 'pii'` indexed lookup.
--
-- org_id denormalized for §1 — saves a join through env_connectors → envs.
CREATE TABLE IF NOT EXISTS column_classifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id      UUID NOT NULL REFERENCES env_connectors(id) ON DELETE CASCADE,
  schema_name       TEXT NOT NULL,
  table_name        TEXT NOT NULL,
  column_name       TEXT NOT NULL,
  label             TEXT NOT NULL CHECK (label IN ('safe', 'pii', 'quasi-id', 'secret')),
  source            TEXT NOT NULL CHECK (source IN ('auto', 'operator')),
  sample_confidence NUMERIC(4, 3),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connector_id, schema_name, table_name, column_name)
);

CREATE INDEX IF NOT EXISTS column_classifications_conn_label_idx
  ON column_classifications (connector_id, label);

CREATE INDEX IF NOT EXISTS column_classifications_org_idx
  ON column_classifications (org_id);

-- ---------------------------------------------------------------------------
-- 4. audit_events — immutable, append-only, ≥12mo retention class
-- ---------------------------------------------------------------------------
-- Separate from automation_runs because runs get their output_text purged on
-- output_retention_days (default 30); audit_events outlive runs and prove
-- the safeguards were in place at the time.
--
-- payload never contains raw row content or summary text — those live on
-- automation_runs (and get purged). Audit captures the META: who, what mode,
-- which provider/region, what plan hash, what acks.

CREATE TABLE IF NOT EXISTS audit_events (
  id              BIGSERIAL PRIMARY KEY,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  env_id          UUID REFERENCES envs(id) ON DELETE SET NULL,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  automation_id   UUID REFERENCES automations(id) ON DELETE SET NULL,
  run_id          UUID REFERENCES automation_runs(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  plan_hash       TEXT,
  redaction_mode  TEXT,
  provider        TEXT,
  provider_region TEXT,
  ack_payload     JSONB,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_events_env_recent_idx
  ON audit_events (env_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_org_recent_idx
  ON audit_events (org_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_automation_idx
  ON audit_events (automation_id, occurred_at DESC) WHERE automation_id IS NOT NULL;

-- Append-only enforcement. Postgres has no native primitive; triggers + the
-- application's PG role (which gets INSERT/SELECT but NOT UPDATE/DELETE/
-- TRUNCATE) together form the contract.

CREATE OR REPLACE FUNCTION audit_events_no_modify()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; UPDATE/DELETE forbidden';
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_no_modify();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_events_no_delete
    BEFORE DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_no_modify();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Notes for the implementation pass that follows:
--
-- 1. The runtime classifier rules live in TypeScript
--    (apps/api/src/automations/redactor/rules.ts), NOT in the DB.
--    SECRET_NAME_REGEX from spec §2.2 is the source of truth.
--
-- 2. The cell-value masker and SQL SELECT-list rewriter
--    (apps/api/src/automations/redactor/index.ts) consume
--    column_classifications + the rules module.
--
-- 3. The nightly output_text purge job:
--      UPDATE automation_runs SET output_text = NULL, error_detail = NULL
--       WHERE finished_at < now() - (
--         SELECT a.output_retention_days * interval '1 day'
--           FROM automations a WHERE a.id = automation_runs.automation_id
--       )
--    runs as a BullMQ repeatable; per-run audit event written for each row.
--
-- 4. The default `redaction_mode='mask-sensitive'` is the SAFE default for
--    every automation — even the ones that already exist from M8. They'll
--    need to be re-previewed before they can fire under the new contract.
-- ---------------------------------------------------------------------------
