/**
 * Envs CRUD — the "Speedo Delivery"-style per-customer tenants.
 *
 *   GET    /envs              list every env in orgs the user belongs to
 *   POST   /envs              create one in the named org (default = first)
 *   GET    /envs/:slug        detail + per-env stats + recent requests
 *   PATCH  /envs/:slug        rename + change primary_model
 *   DELETE /envs/:slug        cascade delete (cascades wire through FKs)
 *
 * Scope: every read joins through `memberships` so the user only ever sees
 * envs in their orgs. Mutations require role IN ('owner','admin') in the
 * env's owning org. Slug is global-unique (it goes in the URL path), with
 * a `-N` suffix on collisions so creation never surfaces a UX-level conflict.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { requireUser } from '../auth/middleware.js';
import { canWrite, userOrgIds, userRoleIn } from '../auth/orgs.js';

const SLUG_RE = /[^a-z0-9-]+/g;
const SLUG_DEDUP = /-+/g;

function slugify(s: string): string {
  const cleaned = (s || '')
    .toLowerCase()
    .trim()
    .replace(SLUG_RE, '-')
    .replace(SLUG_DEDUP, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, 48) || 'untitled';
}

async function uniqueEnvSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rowCount } = await db().query(
      `SELECT 1 FROM envs WHERE slug = $1 LIMIT 1`,
      [candidate],
    );
    if (rowCount === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

interface EnvRow {
  id: string;
  org_id: string;
  org_slug: string;
  org_name: string;
  slug: string;
  name: string;
  primary_model: string;
  created_at: string;
  providers: number;
  sources: number;
  chunks: number;
  api_keys: number;
  requests: number;
  cost_usd: string; // numeric → string by node-postgres default
  last_request_at: string | null;
}

const STATS_SQL = `
  SELECT e.id, e.org_id, o.slug AS org_slug, o.name AS org_name,
         e.slug, e.name, e.primary_model, e.created_at,
         (SELECT COUNT(*)::int FROM providers p WHERE p.env_id = e.id AND p.enabled) AS providers,
         (SELECT COUNT(*)::int FROM sources  s WHERE s.env_id = e.id)                AS sources,
         (SELECT COUNT(*)::int FROM chunks   c WHERE c.env_id = e.id)                AS chunks,
         (SELECT COUNT(*)::int FROM api_keys k WHERE k.env_id = e.id AND k.enabled)  AS api_keys,
         (SELECT COUNT(*)::int FROM requests r WHERE r.env_id = e.id)                AS requests,
         (SELECT COALESCE(SUM(cost_usd), 0)::text FROM requests r WHERE r.env_id = e.id) AS cost_usd,
         (SELECT MAX(created_at) FROM requests r WHERE r.env_id = e.id)              AS last_request_at
    FROM envs e
    JOIN organizations o ON o.id = e.org_id
`;

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, and dashes')
    .optional(),
  org_id: z.string().uuid().optional(),
  primary_model: z.string().min(1).max(120).default('gemini-2.5-flash'),
});

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  primary_model: z.string().min(1).max(120).optional(),
});

export async function registerEnvRoutes(app: FastifyInstance): Promise<void> {
  // ----- GET /envs -----------------------------------------------------------
  app.get('/envs', { onRequest: [requireUser] }, async (req, _reply) => {
    const orgIds = await userOrgIds(req.user!.id);
    if (orgIds.length === 0) return { envs: [] };
    const { rows } = await db().query<EnvRow>(
      `${STATS_SQL} WHERE e.org_id = ANY($1::uuid[])
        ORDER BY e.created_at`,
      [orgIds],
    );
    return { envs: rows };
  });

  // ----- POST /envs ----------------------------------------------------------
  app.post('/envs', { onRequest: [requireUser] }, async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const { name, slug, primary_model } = parsed.data;
    let { org_id } = parsed.data;

    // Default to the user's first org (creation order) if none specified.
    if (!org_id) {
      const orgs = await userOrgIds(req.user!.id);
      org_id = orgs[0];
      if (!org_id) {
        return reply
          .code(400)
          .send({ error: 'no_org', message: 'You are not a member of any organization.' });
      }
    }

    // Confirm the user can write to the chosen org.
    const role = await userRoleIn(req.user!.id, org_id);
    if (role === null) return reply.code(404).send({ error: 'org_not_found' });
    if (!canWrite(role)) return reply.code(403).send({ error: 'forbidden' });

    const candidate = await uniqueEnvSlug(slugify(slug ?? name));
    const { rows } = await db().query<{ id: string; slug: string }>(
      `INSERT INTO envs (org_id, slug, name, primary_model, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, slug`,
      [org_id, candidate, name, primary_model, req.user!.id],
    );
    return reply.code(201).send({ env: rows[0] });
  });

  // ----- GET /envs/:slug -----------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/envs/:slug',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const orgIds = await userOrgIds(req.user!.id);
      if (orgIds.length === 0) return reply.code(404).send({ error: 'env_not_found' });
      const { rows } = await db().query<EnvRow>(
        `${STATS_SQL} WHERE e.slug = $1 AND e.org_id = ANY($2::uuid[]) LIMIT 1`,
        [req.params.slug, orgIds],
      );
      const env = rows[0];
      if (!env) return reply.code(404).send({ error: 'env_not_found' });
      // (M5 fills these in — for now empty arrays so the form view renders
      // without N+1 round-trips and the wire shape stays stable.)
      return {
        env,
        providers: [],
        api_keys: [],
        sources: [],
        recent_requests: [],
      };
    },
  );

  // ----- PATCH /envs/:slug ---------------------------------------------------
  app.patch<{ Params: { slug: string } }>(
    '/envs/:slug',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', issues: parsed.error.issues });
      }
      // Locate the env + its org, then check membership.
      const { rows } = await db().query<{ id: string; org_id: string }>(
        `SELECT id, org_id FROM envs WHERE slug = $1 LIMIT 1`,
        [req.params.slug],
      );
      const found = rows[0];
      if (!found) return reply.code(404).send({ error: 'env_not_found' });
      const role = await userRoleIn(req.user!.id, found.org_id);
      if (role === null) return reply.code(404).send({ error: 'env_not_found' });
      if (!canWrite(role)) return reply.code(403).send({ error: 'forbidden' });

      const sets: string[] = [];
      const values: unknown[] = [];
      const push = (col: string, val: unknown) => {
        values.push(val);
        sets.push(`${col} = $${values.length}`);
      };
      if (parsed.data.name) push('name', parsed.data.name);
      if (parsed.data.primary_model) push('primary_model', parsed.data.primary_model);
      if (sets.length === 0) return { ok: true, changes: 0 };
      values.push(found.id);
      await db().query(
        `UPDATE envs SET ${sets.join(', ')} WHERE id = $${values.length}`,
        values,
      );
      return { ok: true, changes: sets.length };
    },
  );

  // ----- DELETE /envs/:slug --------------------------------------------------
  app.delete<{ Params: { slug: string } }>(
    '/envs/:slug',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const { rows } = await db().query<{ id: string; org_id: string }>(
        `SELECT id, org_id FROM envs WHERE slug = $1 LIMIT 1`,
        [req.params.slug],
      );
      const found = rows[0];
      if (!found) return reply.code(404).send({ error: 'env_not_found' });
      const role = await userRoleIn(req.user!.id, found.org_id);
      if (role === null) return reply.code(404).send({ error: 'env_not_found' });
      if (!canWrite(role)) return reply.code(403).send({ error: 'forbidden' });

      // The FKs on providers/api_keys/sources/chunks/requests all CASCADE
      // through env_id, so a single DELETE wipes the whole tenant.
      await db().query(`DELETE FROM envs WHERE id = $1`, [found.id]);
      return reply.code(204).send();
    },
  );
}
