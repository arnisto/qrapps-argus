-- ----------------------------------------------------------------------------
-- Argus v0.2 — multi-agent pipeline schema
--
-- Adds three tables (`agents`, `pipeline_agents`, `agent_runs`) and a
-- `definition_schema_version` column on `investigators` so the worker can tell
-- legacy single-call investigators from the new pipeline-shaped ones.
--
-- Idempotent. Sourced by both `init.sql` (for first boot) and
-- `apps/api/scripts/migrate-v02.ts` (for upgrades on a live install).
-- ----------------------------------------------------------------------------

-- ----- agents -----------------------------------------------------------------
-- Reusable agent definitions. Each agent is one node in a pipeline; it owns
-- its own provider + model + system prompt + structured-output kind.
CREATE TABLE IF NOT EXISTS agents (
  id                   TEXT PRIMARY KEY,                       -- slug 'evidence-collector'
  name                 TEXT NOT NULL,
  description          TEXT,
  provider             TEXT NOT NULL,                          -- claude|openai|gemini|ollama|deepseek|mock
  model                TEXT NOT NULL,
  system_prompt        TEXT NOT NULL,
  user_prompt_template TEXT,                                   -- optional, appended to default user block
  output_schema_kind   TEXT NOT NULL,                          -- 'text' | 'analysis' | 'finding'
  source               TEXT NOT NULL DEFAULT 'user',           -- 'builtin' | 'user'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----- pipeline_agents --------------------------------------------------------
-- Many-to-many between investigators and agents. `position` is the agent's
-- 0-based index in the linear pipeline; `reads_from` reserves room for v0.3's
-- per-agent input filtering ("all" today, an array of agent ids later).
CREATE TABLE IF NOT EXISTS pipeline_agents (
  investigator_id TEXT NOT NULL REFERENCES investigators(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  position        SMALLINT NOT NULL,
  reads_from      JSONB NOT NULL DEFAULT '"all"'::jsonb,       -- 'all' | ['agent-id', ...]
  PRIMARY KEY (investigator_id, position),
  UNIQUE (investigator_id, agent_id)
);

CREATE INDEX IF NOT EXISTS pipeline_agents_inv_idx
  ON pipeline_agents (investigator_id, position);

-- ----- agent_runs -------------------------------------------------------------
-- One row per agent execution within an investigation. The full rendered
-- system + user prompts and the structured output live here — this is the
-- "reasoning timeline" surface the dashboard renders.
--
-- `agent_id` is a snapshot string, not an FK, so we can keep the trail intact
-- when an agent definition is later deleted.
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
-- v1 = legacy single-call definition (has `checks`/`provider`/`model` inline).
-- v2 = pipeline definition (agents live in pipeline_agents; no `checks`).
ALTER TABLE investigators
  ADD COLUMN IF NOT EXISTS definition_schema_version SMALLINT NOT NULL DEFAULT 1;
