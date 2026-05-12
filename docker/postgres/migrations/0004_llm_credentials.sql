-- ----------------------------------------------------------------------------
-- v0.2.2 — LLM provider credentials in the DB
--
-- Moves API keys out of `.env` and into a real CRUD-able table so each user /
-- deployment can manage multiple keys per provider (e.g. cost-tracked Gemini,
-- enterprise Claude) without touching infra. Agents can opt to use a specific
-- named credential; if none is set, the dashboard falls back to env vars.
--
-- Encryption: for v0.2.2 the key is stored as JSONB with the API key in plain
-- text (DB-only access; redacted on the wire). AES-256-GCM with a server-side
-- master key lands in v0.3 — the column shape (`api_key_enc`) is deliberately
-- forward-compatible.
--
-- Idempotent. Also inlined into init.sql for first boot.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_credentials (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,                          -- 'team-gemini', 'cost-claude'
  provider      TEXT NOT NULL,                          -- claude | openai | gemini | ollama | deepseek
  api_key_enc   TEXT NOT NULL,                          -- key payload; opaque to API consumers
  default_model TEXT,                                   -- optional default when agents don't specify
  is_default    BOOLEAN NOT NULL DEFAULT false,         -- one default per provider
  notes         TEXT,
  last_test_at  TIMESTAMPTZ,
  last_test_ok  BOOLEAN,
  last_test_error TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_credentials_provider_idx
  ON llm_credentials (provider, is_default DESC);

-- Agents can opt into a specific credential. NULL = "use the default for this
-- agent's provider" (which itself falls back to env if no default is set).
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS credential_id TEXT
    REFERENCES llm_credentials(id) ON DELETE SET NULL;
