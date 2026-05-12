-- ----------------------------------------------------------------------------
-- v0.2.1 — per-connector health-test result
--
-- Adds three columns to `connectors` to capture the outcome of the most recent
-- *manual* test (i.e. someone clicking "Test now") — kept separate from
-- `last_sync_at` / `last_error` which are owned by the polling loop. Mixing
-- them would make a stale poll error stomp a fresh successful test (or vice
-- versa) and confuse the operator on /health.
--
-- Idempotent. Source of truth — also inlined into init.sql for first boot.
-- ----------------------------------------------------------------------------

ALTER TABLE connectors
  ADD COLUMN IF NOT EXISTS last_test_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_ok    BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_test_error TEXT;
