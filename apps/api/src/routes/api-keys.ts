/**
 * Per-env Argus API keys.
 *
 *   POST   /envs/:slug/api-keys              mint (returns plaintext ONCE)
 *   GET    /envs/:slug/api-keys              list (no plaintext, just prefix)
 *   DELETE /envs/:slug/api-keys/:id          revoke
 *
 * Plaintext format: `ak_live_<43 base64url chars>`. The prefix saved on
 * the row is `ak_live_<first 6>…<last 4>` — enough to identify the key
 * in the UI without revealing it. The sha256 of the full plaintext is
 * stored in `key_hash BYTEA` and looked up on every /v1/chat call.
 */
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { requireUser } from '../auth/middleware.js';
import { sha256 } from '../auth/api-key.js';
import { resolveEnv } from './env-scope.js';

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  rate_per_min: z.number().int().positive().max(10_000).default(60),
});

function mintToken(): { plaintext: string; prefix: string } {
  const plaintext = `ak_live_${randomBytes(32).toString('base64url')}`;
  // Display prefix: ak_live_<first 6 of token>…<last 4>
  const tok = plaintext.slice('ak_live_'.length);
  const prefix = `ak_live_${tok.slice(0, 6)}…${tok.slice(-4)}`;
  return { plaintext, prefix };
}

export async function registerApiKeyRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /envs/:slug/api-keys --------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/envs/:slug/api-keys',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, false);
      if (!env) return;
      const { rows } = await db().query<{
        id: string;
        name: string;
        key_prefix: string;
        rate_per_min: number;
        enabled: boolean;
        created_at: string;
        last_used_at: string | null;
      }>(
        `SELECT id, name, key_prefix, rate_per_min, enabled, created_at, last_used_at
           FROM api_keys
          WHERE env_id = $1
          ORDER BY created_at DESC`,
        [env.id],
      );
      return { api_keys: rows };
    },
  );

  // ---- POST /envs/:slug/api-keys -------------------------------------------
  // Returns { id, name, key, prefix } — the only response carrying the
  // plaintext key. UI must show it to the user immediately; subsequent
  // GETs only return the prefix.
  app.post<{ Params: { slug: string } }>(
    '/envs/:slug/api-keys',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', issues: parsed.error.issues });
      }
      const { name, rate_per_min } = parsed.data;
      const { plaintext, prefix } = mintToken();
      const hash = sha256(plaintext);
      const { rows } = await db().query<{ id: string }>(
        `INSERT INTO api_keys (env_id, name, key_prefix, key_hash, rate_per_min, created_by)
              VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [env.id, name, prefix, hash, rate_per_min, req.user!.id],
      );
      return reply.code(201).send({
        api_key: {
          id: rows[0]!.id,
          name,
          prefix,
          rate_per_min,
          key: plaintext, // shown once
        },
      });
    },
  );

  // ---- DELETE /envs/:slug/api-keys/:id -------------------------------------
  app.delete<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/api-keys/:id',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      await db().query(
        `DELETE FROM api_keys WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      return reply.code(204).send();
    },
  );
}
