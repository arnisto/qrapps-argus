-- One row per (env_id, provider name). Lets ON CONFLICT cleanly rotate keys
-- on resubmit and prevents multiple rows for the same provider in one env.
--
-- Idempotent — checks for the constraint before adding.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'providers_env_name_unique'
  ) THEN
    ALTER TABLE providers
      ADD CONSTRAINT providers_env_name_unique UNIQUE (env_id, name);
  END IF;
END $$;
