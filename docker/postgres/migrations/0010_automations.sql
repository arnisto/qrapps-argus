-- M8.1 — Automations foundation.
--
-- Scheduled jobs that read from a connector, render text via the LLM, and
-- send the output through a channel. Designed to scale to ~1000+ rows
-- per env at ~100 envs per install.
--
-- See docs/ARCHITECTURE_AUTOMATIONS.md for the full design (compile-at-save,
-- Postgres-as-schedule-truth, BullMQ-as-execution, env-tz everywhere).
--
-- Idempotent — every CREATE uses IF NOT EXISTS / DO blocks so we can
-- re-run without harm.

DO $$ BEGIN
  CREATE TYPE automation_status AS ENUM ('draft', 'active', 'paused', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE automation_run_st AS ENUM (
    'queued', 'running', 'ok', 'failed', 'timed_out', 'cancelled', 'suppressed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE automation_trigger AS ENUM ('cron', 'manual', 'preview');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- automations — the definition + the schedule + the frozen compiled plan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id               UUID NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  -- The source of truth for recompilation. Operators can edit this freely;
  -- compiled_plan only changes on explicit "Recompile" or save.
  prompt_text          TEXT NOT NULL,
  -- {read, render, send} per ARCHITECTURE_AUTOMATIONS.md §3. Empty in
  -- draft state until the first compile.
  compiled_plan        JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan_compiler_model  TEXT,
  plan_compiled_at     TIMESTAMPTZ,
  -- The schedule — cron string in `schedule_tz`. NULL only in draft.
  schedule_cron        TEXT,
  schedule_tz          TEXT NOT NULL DEFAULT 'UTC',
  -- Computed by the dispatcher on activation + after each run. NULL when
  -- the automation is paused or disabled.
  next_run_at          TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ,
  status               automation_status NOT NULL DEFAULT 'draft',
  -- Resets to 0 on every successful run. Auto-pause after 5.
  consecutive_failures INT NOT NULL DEFAULT 0,
  -- Cost ceilings, per architecture brief §5.
  daily_cost_cap_usd   NUMERIC(10, 4) NOT NULL DEFAULT 1.00,
  per_run_token_cap    INT NOT NULL DEFAULT 50000,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (env_id, name)
);

-- The dispatcher's hot path. Partial index: only walks rows that could
-- actually fire next. At 100k total rows this scans ~hundreds at any
-- given moment instead of the whole table.
CREATE INDEX IF NOT EXISTS automations_due_idx ON automations (next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;

-- Plain env_id lookup index for the /automations list view.
CREATE INDEX IF NOT EXISTS automations_env_idx ON automations (env_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- automation_runs — one row per scheduled occurrence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  -- Denormalised — lets the fleet-view query "show me every run today"
  -- without joining automations.
  env_id        UUID NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  -- The SCHEDULED slot. NOT the start time. Two runs of the same
  -- automation never share an occurrence_ts; the UNIQUE below is the
  -- idempotency anchor across Postgres + Redis + Slack double-send risk.
  occurrence_ts TIMESTAMPTZ NOT NULL,
  trigger       automation_trigger NOT NULL,
  status        automation_run_st  NOT NULL DEFAULT 'queued',
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  -- Mirrors argus_tool_trace shape from llm/chat.ts — same structure, no
  -- join, queryable with `->`. JSONB array of step objects:
  --   [{kind: 'read', connector_id, sql, rows_returned, latency_ms, ok},
  --    {kind: 'render', model, tokens, latency_ms, ok},
  --    {kind: 'send', connector_id, channel, external_id, latency_ms, ok}]
  step_trace    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The actual text that got sent (or would have been sent, for previews).
  output_text   TEXT,
  tokens_used   INT,
  cost_usd      NUMERIC(10, 6),
  error_class   TEXT,
  error_detail  TEXT,
  UNIQUE (automation_id, occurrence_ts)
);

-- Fleet view: "show me every run for env X today, newest first".
CREATE INDEX IF NOT EXISTS automation_runs_env_recent_idx
  ON automation_runs (env_id, started_at DESC);

-- Per-automation history view: "show me the last 50 runs of this automation".
CREATE INDEX IF NOT EXISTS automation_runs_auto_recent_idx
  ON automation_runs (automation_id, started_at DESC);

-- Failure-mode query: "which automations failed today".
CREATE INDEX IF NOT EXISTS automation_runs_env_status_idx
  ON automation_runs (env_id, status, started_at DESC);
