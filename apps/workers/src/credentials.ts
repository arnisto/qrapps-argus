import type pg from 'pg';
import type { ProviderId, ResolvedCredentials } from '@argus/ai-providers';

/**
 * Resolve LLM credentials at runtime, in priority order:
 *
 *   1. `agent.credential_id` → the row that agent explicitly references
 *   2. The provider's default credential (`is_default = true`)
 *   3. `null` — registry will fall back to env vars
 *
 * Returning `null` (not throwing) keeps the env fallback alive — useful for
 * fresh installs and CI where no credential rows exist yet.
 */
export async function resolveCredentials(
  pool: pg.Pool,
  agent: { provider: ProviderId; credential_id?: string | null },
): Promise<ResolvedCredentials | null> {
  if (agent.credential_id) {
    const row = await pool.query<{
      api_key_enc: string;
      default_model: string | null;
      provider: ProviderId;
    }>('SELECT api_key_enc, default_model, provider FROM llm_credentials WHERE id = $1', [
      agent.credential_id,
    ]);
    if (row.rowCount && row.rows[0]) {
      // Caller's `provider` should match; if it doesn't, we still hand back
      // the credential (it's the caller's responsibility to pick coherent
      // combos). Logging a warning would be appropriate in v0.3.
      const r = row.rows[0];
      return { apiKey: r.api_key_enc, model: r.default_model ?? undefined };
    }
  }

  // Fall back to the per-provider default.
  const def = await pool.query<{ api_key_enc: string; default_model: string | null }>(
    `SELECT api_key_enc, default_model
     FROM llm_credentials
     WHERE provider = $1 AND is_default = true
     LIMIT 1`,
    [agent.provider],
  );
  if (def.rowCount && def.rows[0]) {
    return { apiKey: def.rows[0].api_key_enc, model: def.rows[0].default_model ?? undefined };
  }

  return null;
}
