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
import { type ProviderRow } from '../llm/gemini.js';
import { chatComplete } from '../llm/router.js';
import { decryptKey, encryptKey } from '../llm/secret.js';
import { resolveEnv } from './env-scope.js';

const SUPPORTED = ['gemini', 'groq'] as const;
type SupportedName = (typeof SUPPORTED)[number];

// Per-provider sensible defaults — used by the UI's connect form. The
// shape mirrors what the buyer would type if they read the docs.
export const PROVIDER_DEFAULTS: Record<
  SupportedName,
  { default_model: string; placeholder: string; key_help: string }
> = {
  gemini: {
    default_model: 'gemini-2.5-flash',
    placeholder: 'AIzaSy…',
    key_help: 'Get one at aistudio.google.com — free tier is enough to demo.',
  },
  groq: {
    default_model: 'llama-3.3-70b-versatile',
    placeholder: 'gsk_…',
    key_help: 'Get one at console.groq.com/keys — free tier has very fast inference.',
  },
};

const CreateBody = z.object({
  name: z.enum(SUPPORTED),
  api_key: z.string().min(1).max(2000),
  // Default model is per-provider — caller should pass it; we leave the
  // default empty here and fall back at write-time so we don't hard-code
  // gemini-2.5-flash for a groq write.
  default_model: z.string().min(1).max(120).optional(),
  base_url: z.string().url().optional(),
  /**
   * When true, upsert this provider into EVERY env in the same org where
   * the user has write access. Lets the operator pay for one provider key
   * and use it across Marketing / Sales / RH without re-typing.
   */
  apply_to_org: z.boolean().default(false),
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
      const { name, api_key, base_url, apply_to_org } = parsed.data;
      const default_model = parsed.data.default_model ?? PROVIDER_DEFAULTS[name].default_model;
      const enc = encryptKey(api_key);

      // Decide target envs. Default: just this env. With apply_to_org:
      // every env in THIS env's org (which the user is already a member
      // of, since resolveEnv passed). We do NOT cross orgs even if the
      // user has memberships elsewhere — the key was minted in this org's
      // workspace, so its scope shouldn't silently widen.
      const targetEnvIds: string[] = [env.id];
      if (apply_to_org) {
        const { rows: orgEnvs } = await db().query<{ id: string }>(
          `SELECT id FROM envs WHERE org_id = $1 AND id <> $2`,
          [env.org_id, env.id],
        );
        for (const e of orgEnvs) targetEnvIds.push(e.id);
      }

      // Upsert across every target env in one statement.
      const { rows } = await db().query<{ id: string; env_id: string }>(
        `INSERT INTO providers (env_id, name, base_url, default_model, api_key_ct, api_key_iv)
              SELECT unnest($1::uuid[]), $2, $3, $4, $5, $6
         ON CONFLICT (env_id, name)
         DO UPDATE SET
            base_url = EXCLUDED.base_url,
            default_model = EXCLUDED.default_model,
            api_key_ct = EXCLUDED.api_key_ct,
            api_key_iv = EXCLUDED.api_key_iv,
            enabled = TRUE
         RETURNING id, env_id`,
        [targetEnvIds, name, base_url ?? null, default_model, enc.ct, enc.iv],
      );
      // Surface the row corresponding to the env in the URL so the UI
      // can highlight "this one"; everything else is also confirmed via
      // applied_to.
      const self = rows.find((r) => r.env_id === env.id) ?? rows[0]!;
      return reply.code(201).send({
        provider: { id: self.id, name },
        applied_to: rows.length, // = 1 normally, or N if apply_to_org
      });
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
      try {
        const p: ProviderRow = {
          name: r.name,
          base_url: r.base_url,
          default_model: r.default_model,
          api_key: decryptKey({ ct: r.api_key_ct, iv: r.api_key_iv }),
        };
        const resp = await chatComplete(
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
