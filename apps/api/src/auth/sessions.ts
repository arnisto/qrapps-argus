/**
 * Session token lifecycle.
 *
 * Token shape: 32 random bytes, base64url-encoded → ~43 chars. The cookie
 * carries the plaintext; we look up by sha256(plaintext). Server compromise
 * never reveals live tokens (the DB has only hashes), and revocation is just
 * `DELETE FROM sessions`.
 *
 * TTL: 30 days, slid forward on every authed request that hits
 * `touchSession`. Expired rows are filtered out by query and reaped lazily.
 */
import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db.js';

export const SESSION_COOKIE = 'argus_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: Date;
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ipAddr?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db().query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_addr, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, meta.userAgent ?? null, meta.ipAddr ?? null, expiresAt],
  );
  return { token, expiresAt };
}

export async function lookupSession(token: string): Promise<SessionRecord | null> {
  const { rows } = await db().query<SessionRecord>(
    `SELECT id, user_id, expires_at
       FROM sessions
      WHERE token_hash = $1 AND expires_at > now()
      LIMIT 1`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function touchSession(sessionId: string): Promise<void> {
  // Sliding window: bump last_used_at + extend expiry on every authed hit.
  await db().query(
    `UPDATE sessions
        SET last_used_at = now(),
            expires_at   = now() + $2::interval
      WHERE id = $1`,
    [sessionId, `${SESSION_TTL_MS} milliseconds`],
  );
}

export async function destroySession(token: string): Promise<void> {
  await db().query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await db().query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}
