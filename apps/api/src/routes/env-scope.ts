/**
 * Helper: resolve an env by slug + check the current user has membership
 * in its owning org. Centralised so every per-env route enforces the
 * same shape (404 on unknown / non-member, 403 on read-only role for
 * writes).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db.js';
import { canWrite, userRoleIn } from '../auth/orgs.js';

export interface ScopedEnv {
  id: string;
  org_id: string;
  slug: string;
  primary_model: string;
}

/**
 * Look up the env, confirm the user is a member of its org, and (if
 * requireWrite) confirm the role allows mutation. Sends the appropriate
 * error response itself and returns null on failure so callers can early-return.
 */
export async function resolveEnv(
  req: FastifyRequest,
  reply: FastifyReply,
  slug: string,
  requireWrite: boolean,
): Promise<ScopedEnv | null> {
  const { rows } = await db().query<ScopedEnv>(
    `SELECT id, org_id, slug, primary_model FROM envs WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  const env = rows[0];
  if (!env) {
    reply.code(404).send({ error: 'env_not_found' });
    return null;
  }
  const role = await userRoleIn(req.user!.id, env.org_id);
  if (role === null) {
    reply.code(404).send({ error: 'env_not_found' });
    return null;
  }
  if (requireWrite && !canWrite(role)) {
    reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return env;
}
