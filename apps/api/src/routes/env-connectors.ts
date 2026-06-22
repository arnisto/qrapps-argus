/**
 * Per-env connector routes.
 *
 *   GET    /connectors/catalog              public marketplace listing
 *   GET    /envs/:slug/env-connectors       list of what's connected
 *   POST   /envs/:slug/env-connectors       create + immediately test +
 *                                            schema-crawl (PG-specific)
 *   POST   /envs/:slug/env-connectors/:id/recrawl
 *   DELETE /envs/:slug/env-connectors/:id   removes connector + its
 *                                            crawled sources (`connector://<id>`)
 *
 * Subtype-specific logic lives in `apps/api/src/connectors/adapters/*`.
 * The route is the orchestrator; the adapter does the heavy lifting.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { requireUser } from '../auth/middleware.js';
import { encryptKey } from '../llm/secret.js';
import { resolveEnv } from './env-scope.js';
import { CATALOG, catalogBySubtype } from '../connectors/catalog.js';
import {
  crawlSchema as pgCrawlSchema,
  testConnect as pgTest,
  type PgConfig,
  type PgSecret,
} from '../connectors/adapters/postgres.js';

const CreateBody = z.object({
  subtype: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  config: z.record(z.string(), z.unknown()).default({}),
  secret: z.record(z.string(), z.unknown()).default({}),
});

interface ConnectorRow {
  id: string;
  env_id: string;
  kind: string;
  subtype: string;
  name: string;
  config: Record<string, unknown>;
  status: string;
  status_detail: string | null;
  last_synced_at: string | null;
  enabled: boolean;
  created_at: string;
  /** True when secret bytes are stored. Plaintext never leaves the API. */
  has_secret: boolean;
  /** Count of sources that came from this connector's crawl. */
  source_count: number;
}

export async function registerEnvConnectorRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /connectors/catalog (PUBLIC) ------------------------------------
  // Open without auth so the marketplace can render on the unauthed landing
  // page later. Contains zero env-specific data.
  app.get('/connectors/catalog', async () => {
    return { catalog: CATALOG };
  });

  // ---- GET /envs/:slug/env-connectors --------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/envs/:slug/env-connectors',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, false);
      if (!env) return;
      const { rows } = await db().query<ConnectorRow>(
        `SELECT c.id, c.env_id, c.kind::text, c.subtype, c.name,
                c.config, c.status, c.status_detail, c.last_synced_at,
                c.enabled, c.created_at,
                (c.secret_ct IS NOT NULL AND octet_length(c.secret_ct) > 0) AS has_secret,
                (SELECT COUNT(*)::int FROM sources s
                  WHERE s.env_id = c.env_id
                    AND s.uri = 'connector://' || c.id::text) AS source_count
           FROM env_connectors c
          WHERE c.env_id = $1
          ORDER BY c.created_at DESC`,
        [env.id],
      );
      return { connectors: rows };
    },
  );

  // ---- POST /envs/:slug/env-connectors -------------------------------------
  app.post<{ Params: { slug: string } }>(
    '/envs/:slug/env-connectors',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
      }
      const { subtype, name } = parsed.data;
      const entry = catalogBySubtype(subtype);
      if (!entry) return reply.code(400).send({ error: 'unknown_subtype' });
      if (entry.status !== 'available') {
        return reply.code(400).send({ error: 'subtype_coming_soon' });
      }

      // Run a per-subtype test before persisting. Better to surface a bad
      // credential immediately than to save then 401 on first use.
      if (subtype === 'postgres') {
        const cfg = parsed.data.config as unknown as PgConfig;
        const sec = parsed.data.secret as unknown as PgSecret;
        const test = await pgTest(cfg, sec);
        if (!test.ok) {
          return reply.code(400).send({
            error: 'connection_failed',
            message: test.error ?? 'unknown',
          });
        }

        // Encrypt the secret blob once. We store the entire `secret` JSON
        // so we can pass it as-is to the adapter on re-crawl.
        const enc = encryptKey(JSON.stringify(parsed.data.secret));

        // Insert with status='crawling' so the UI can show a spinner.
        const { rows } = await db().query<{ id: string }>(
          `INSERT INTO env_connectors
                  (env_id, kind, subtype, name, config, secret_ct, secret_iv,
                   status, status_detail, created_by)
                  VALUES ($1, 'db', 'postgres', $2, $3, $4, $5,
                          'crawling', $6, $7)
           ON CONFLICT (env_id, name) DO UPDATE
              SET config = EXCLUDED.config,
                  secret_ct = EXCLUDED.secret_ct,
                  secret_iv = EXCLUDED.secret_iv,
                  status = 'crawling',
                  status_detail = $6
           RETURNING id`,
          [
            env.id,
            name,
            parsed.data.config,
            enc.ct,
            enc.iv,
            `Connected. Will index ${test.tables_visible} table(s)…`,
            req.user!.id,
          ],
        );
        const connectorId = rows[0]!.id;

        // Crawl synchronously. For the demo this is fine (small DBs);
        // a follow-up moves this to BullMQ when we see crawls > 30s in the wild.
        const out = await pgCrawlSchema(env.id, cfg, sec, connectorId, name, req.user!.id);

        if (!out.ok) {
          await db().query(
            `UPDATE env_connectors
                SET status = 'error', status_detail = $2
              WHERE id = $1`,
            [connectorId, out.errors.slice(0, 3).join('; ')],
          );
        }

        return reply.code(201).send({
          connector: {
            id: connectorId,
            subtype,
            name,
            status: out.ok ? 'connected' : 'error',
            tables_indexed: out.tables_indexed,
            chunks_indexed: out.chunks_indexed,
            errors: out.errors,
            test_summary: test,
          },
        });
      }

      return reply.code(400).send({
        error: 'subtype_not_implemented',
        message: `Connector subtype '${subtype}' is in the catalog but not wired yet.`,
      });
    },
  );

  // ---- POST /envs/:slug/env-connectors/:id/recrawl -------------------------
  app.post<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/env-connectors/:id/recrawl',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const { rows } = await db().query<{
        subtype: string;
        name: string;
        config: PgConfig;
        secret_ct: Buffer;
        secret_iv: Buffer;
      }>(
        `SELECT subtype, name, config, secret_ct, secret_iv
           FROM env_connectors WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      const c = rows[0];
      if (!c) return reply.code(404).send({ error: 'connector_not_found' });
      if (c.subtype !== 'postgres') {
        return reply.code(400).send({ error: 'subtype_not_implemented' });
      }
      const { decryptKey } = await import('../llm/secret.js');
      const secret = JSON.parse(decryptKey({ ct: c.secret_ct, iv: c.secret_iv })) as PgSecret;
      const out = await pgCrawlSchema(env.id, c.config, secret, req.params.id, c.name, req.user!.id);
      return { ok: out.ok, tables_indexed: out.tables_indexed, errors: out.errors };
    },
  );

  // ---- DELETE /envs/:slug/env-connectors/:id -------------------------------
  app.delete<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/env-connectors/:id',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      // Cascade: chunks → sources (FK), and now the sources that came from
      // this connector. The connector row is the last to drop.
      await db().query(
        `DELETE FROM sources WHERE env_id = $1 AND uri = $2`,
        [env.id, `connector://${req.params.id}`],
      );
      await db().query(
        `DELETE FROM env_connectors WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      return reply.code(204).send();
    },
  );
}
