/**
 * Argus API key verification.
 *
 * Wire format: `Authorization: Bearer ak_live_<urlsafe-token>`.
 * Lookup: sha256(plaintext) → `api_keys.key_hash` BYTEA UNIQUE. Plaintext
 * is shown ONCE at mint and never stored.
 *
 * On a successful match we touch `last_used_at` fire-and-forget so the
 * verify path stays fast and the dashboard stays current within seconds.
 */
import { createHash } from 'node:crypto';
import { db } from '../db.js';

export interface VerifiedKey {
  key_id: string;
  env_id: string;
  org_id: string;
  rate_per_min: number;
}

export function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

export async function verifyApiKey(bearer: string): Promise<VerifiedKey | null> {
  if (!bearer || !bearer.startsWith('ak_live_')) return null;
  const hash = sha256(bearer);
  const { rows } = await db().query<VerifiedKey>(
    `SELECT k.id AS key_id, k.env_id, k.rate_per_min, e.org_id
       FROM api_keys k
       JOIN envs e ON e.id = k.env_id
      WHERE k.key_hash = $1 AND k.enabled
      LIMIT 1`,
    [hash],
  );
  const found = rows[0];
  if (!found) return null;
  // Fire-and-forget; failure here must not 401 the request.
  void db()
    .query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [found.key_id])
    .catch(() => {});
  return found;
}
