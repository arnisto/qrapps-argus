/**
 * Per-env provider CRUD.
 *
 *   GET    /envs/:slug/providers              list (no plaintext key)
 *   POST   /envs/:slug/providers              create / upsert (Gemini-only today)
 *   POST   /envs/:slug/providers/:id/test     ping the provider with a tiny prompt
 *   DELETE /envs/:slug/providers/:id          remove
 *
 * Keys are AES-GCM encrypted at rest via `llm/secret.ts` and never sent
 * back over the wire — only a `has_key: true/false` flag.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { requireUser } from '../auth/middleware.js';
import { complete, type ProviderRow } from '../llm/gemini.js';
import { decryptKey, encryptKey } from '../llm/secret.js';
import { resolveEnv } from './env-scope.js';

const SUPPORTED = ['gemini'] as const; // M5-narrow: Gemini only.
type SupportedName = (typeof SUPPORTED)[number];

const CreateBody = z.object({
  name: z.enum(SUPPORTED),
  api_key: z.string().min(1).max(2000),
  default_model: z.string().min(1).max(120).default('gemini-2.5-flash'),
  base_url: z.string().url().optional(),
});

interface ProviderListRow {
  id: string;
  name: string;
  default_model: string;
  base_url: string | null;
  enabled: boolean;
  has_key: boolean;
  created_at: string;
}

/** Load the active row for a provider name in the given env, decrypted. */
export async function loadProviderForEnv(
  envId: string,
  name: SupportedName,
): Promise<ProviderRow | null> {
  const { rows } = await db().query<{
    name: string;
    base_url: string | null;
    default_model: string;
    api_key_ct: Buffer;
    api_key_iv: Buffer;
  }>(
    `SELECT name, base_url, default_model, api_key_ct, api_key_iv
       FROM providers
      WHERE env_id = $1 AND name = $2 AND enabled
      LIMIT 1`,
    [envId, name],
  );
  const r = rows[0];
  if (!r || !r.api_key_ct?.length) return null;
  return {
    name: r.name,
    base_url: r.base_url,
    default_model: r.default_model,
    api_key: decryptKey({ ct: r.api_key_ct, iv: r.api_key_iv }),
  };
}

export async function registerProviderRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /envs/:slug/providers -------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/envs/:slug/providers',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, false);
      if (!env) return;
      const { rows } = await db().query<ProviderListRow>(
        `SELECT id, name, default_model, base_url, enabled,
                (api_key_ct IS NOT NULL AND octet_length(api_key_ct) > 0) AS has_key,
                created_at
           FROM providers
          WHERE env_id = $1
          ORDER BY created_at`,
        [env.id],
      );
      return { providers: rows };
    },
  );

  // ---- POST /envs/:slug/providers ------------------------------------------
  // Upserts on (env_id, name) so resubmitting rotates the key cleanly.
  app.post<{ Params: { slug: string } }>(
    '/envs/:slug/providers',
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
      const { name, api_key, default_model, base_url } = parsed.data;
      const enc = encryptKey(api_key);
      const { rows } = await db().query<{ id: string }>(
        `INSERT INTO providers (env_id, name, base_url, default_model, api_key_ct, api_key_iv)
              VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [env.id, name, base_url ?? null, default_model, enc.ct, enc.iv],
      );
      let id = rows[0]?.id;
      if (!id) {
        // Conflict path — update the existing row in-place.
        const upd = await db().query<{ id: string }>(
          `UPDATE providers
              SET base_url = $3, default_model = $4,
                  api_key_ct = $5, api_key_iv = $6, enabled = true
            WHERE env_id = $1 AND name = $2
            RETURNING id`,
          [env.id, name, base_url ?? null, default_model, enc.ct, enc.iv],
        );
        id = upd.rows[0]?.id;
      }
      return reply.code(201).send({ provider: { id, name } });
    },
  );

  // ---- POST /envs/:slug/providers/:id/test ---------------------------------
  app.post<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/providers/:id/test',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, false);
      if (!env) return;
      const { rows } = await db().query<{
        name: string;
        base_url: string | null;
        default_model: string;
        api_key_ct: Buffer;
        api_key_iv: Buffer;
      }>(
        `SELECT name, base_url, default_model, api_key_ct, api_key_iv
           FROM providers WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      const r = rows[0];
      if (!r) return reply.code(404).send({ error: 'provider_not_found' });
      if (r.name !== 'gemini') {
        return reply
          .code(400)
          .send({ error: 'unsupported_provider', message: `Test for ${r.name} not wired yet.` });
      }
      try {
        const p: ProviderRow = {
          name: r.name,
          base_url: r.base_url,
          default_model: r.default_model,
          api_key: decryptKey({ ct: r.api_key_ct, iv: r.api_key_iv }),
        };
        const resp = await complete(
          p,
          r.default_model,
          [{ role: 'user', content: 'Reply with exactly the two letters: OK' }],
          { max_tokens: 16, temperature: 0 },
        );
        return {
          ok: true,
          model: r.default_model,
          text: resp.choices[0]?.message.content?.slice(0, 80) ?? '',
          latency_ms: resp._argus?.latency_ms ?? null,
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // ---- DELETE /envs/:slug/providers/:id ------------------------------------
  app.delete<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/providers/:id',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      await db().query(
        `DELETE FROM providers WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      return reply.code(204).send();
    },
  );
}
