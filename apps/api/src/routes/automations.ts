/**
 * Automations routes — M8.1 foundation.
 *
 *   GET    /envs/:slug/automations              list (with run_count + last_run summary)
 *   POST   /envs/:slug/automations              create (saves as draft)
 *   GET    /envs/:slug/automations/:id          detail
 *   PATCH  /envs/:slug/automations/:id          update name/prompt/schedule/caps
 *   DELETE /envs/:slug/automations/:id
 *   POST   /envs/:slug/automations/:id/pause    status='active' → 'paused'
 *   POST   /envs/:slug/automations/:id/resume   status='paused' → 'active', sets next_run_at
 *   POST   /envs/:slug/automations/:id/preview  501 stub (lands in M8.2/8.3 with compiler+runner)
 *   POST   /envs/:slug/automations/:id/run-now  501 stub (lands in M8.3 with runner)
 *   GET    /envs/:slug/automations/:id/runs     run history (paginated)
 *
 * The compiler (M8.2) and the dispatcher+runner (M8.3) land in the next pushes.
 * The CRUD foundation here ships first so the UI can wire end-to-end.
 *
 * See docs/ARCHITECTURE_AUTOMATIONS.md for the load-bearing decisions.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { requireUser } from '../auth/middleware.js';
import { resolveEnv } from './env-scope.js';

// ---------------------------------------------------------------------------
// Zod boundaries
// ---------------------------------------------------------------------------

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  prompt_text: z.string().min(1).max(8000),
  /** Optional at create time — compiler (M8.2) can fill from prompt_text. */
  schedule_cron: z.string().min(1).max(80).optional(),
  schedule_tz: z.string().min(1).max(60).default('UTC'),
  daily_cost_cap_usd: z.number().positive().max(1000).default(1),
  per_run_token_cap: z.number().int().positive().max(1_000_000).default(50_000),
});

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  prompt_text: z.string().min(1).max(8000).optional(),
  schedule_cron: z.string().min(1).max(80).optional(),
  schedule_tz: z.string().min(1).max(60).optional(),
  daily_cost_cap_usd: z.number().positive().max(1000).optional(),
  per_run_token_cap: z.number().int().positive().max(1_000_000).optional(),
});

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface AutomationRow {
  id: string;
  env_id: string;
  name: string;
  prompt_text: string;
  compiled_plan: Record<string, unknown>;
  plan_compiler_model: string | null;
  plan_compiled_at: string | null;
  schedule_cron: string | null;
  schedule_tz: string;
  next_run_at: string | null;
  last_run_at: string | null;
  status: 'draft' | 'active' | 'paused' | 'disabled';
  consecutive_failures: number;
  daily_cost_cap_usd: string;
  per_run_token_cap: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface AutomationWithStats extends AutomationRow {
  run_count: number;
  last_run_status: string | null;
  last_run_started_at: string | null;
}

interface RunRow {
  id: string;
  automation_id: string;
  env_id: string;
  occurrence_ts: string;
  trigger: 'cron' | 'manual' | 'preview';
  status: string;
  started_at: string | null;
  finished_at: string | null;
  step_trace: unknown[];
  output_text: string | null;
  tokens_used: number | null;
  cost_usd: string | null;
  error_class: string | null;
  error_detail: string | null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /envs/:slug/automations -----------------------------------------
  // List with last-run summary fields (powers the /automations list page).
  // The lateral join pulls the most-recent run per automation in one query;
  // at 200+ automations this beats N+1 round-trips.
  app.get<{ Params: { slug: string } }>(
    '/envs/:slug/automations',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, false);
      if (!env) return;
      const { rows } = await db().query<AutomationWithStats>(
        `SELECT a.*,
                COALESCE(stats.run_count, 0)::int     AS run_count,
                last_run.status::text                 AS last_run_status,
                last_run.started_at                   AS last_run_started_at
           FROM automations a
           LEFT JOIN LATERAL (
             SELECT count(*) AS run_count FROM automation_runs r
              WHERE r.automation_id = a.id
           ) stats ON true
           LEFT JOIN LATERAL (
             SELECT r.status, r.started_at FROM automation_runs r
              WHERE r.automation_id = a.id
              ORDER BY r.started_at DESC NULLS LAST
              LIMIT 1
           ) last_run ON true
          WHERE a.env_id = $1
          ORDER BY a.created_at DESC`,
        [env.id],
      );
      return { automations: rows };
    },
  );

  // ---- POST /envs/:slug/automations ----------------------------------------
  // Creates as 'draft'. compiled_plan stays empty until the compiler ships
  // (M8.2) or the operator provides a structured plan via PATCH.
  app.post<{ Params: { slug: string } }>(
    '/envs/:slug/automations',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
      }
      const b = parsed.data;
      try {
        const { rows } = await db().query<AutomationRow>(
          `INSERT INTO automations
                  (env_id, name, prompt_text, schedule_cron, schedule_tz,
                   daily_cost_cap_usd, per_run_token_cap, created_by)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            env.id,
            b.name,
            b.prompt_text,
            b.schedule_cron ?? null,
            b.schedule_tz,
            b.daily_cost_cap_usd,
            b.per_run_token_cap,
            req.user!.id,
          ],
        );
        return reply.code(201).send({ automation: rows[0] });
      } catch (err) {
        const msg = (err as { code?: string; message?: string }).message ?? '';
        if (msg.includes('automations_env_id_name_key')) {
          return reply.code(409).send({
            error: 'duplicate_name',
            message: `An automation called "${b.name}" already exists in this env.`,
          });
        }
        throw err;
      }
    },
  );

  // ---- GET /envs/:slug/automations/:id -------------------------------------
  app.get<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/automations/:id',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, false);
      if (!env) return;
      const { rows } = await db().query<AutomationRow>(
        `SELECT * FROM automations WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'automation_not_found' });
      return { automation: rows[0] };
    },
  );

  // ---- PATCH /envs/:slug/automations/:id -----------------------------------
  // Partial update. If prompt_text changes, the existing compiled_plan is
  // invalidated (set back to {}) so the next preview/run forces a re-compile.
  app.patch<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/automations/:id',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
      }
      const fields: string[] = [];
      const params: unknown[] = [req.params.id, env.id];
      let i = 3;
      for (const [k, v] of Object.entries(parsed.data)) {
        if (v === undefined) continue;
        fields.push(`${k} = $${i++}`);
        params.push(v);
      }
      if (fields.length === 0) {
        return reply.code(400).send({ error: 'no_changes' });
      }
      // Invalidate the compiled plan if prompt_text changed — forces re-compile
      // on next preview/run. The operator sees this in the UI as "Plan stale —
      // click Recompile". Never auto-recompile (foot-gun, see brief §10).
      if (parsed.data.prompt_text !== undefined) {
        fields.push(`compiled_plan = '{}'::jsonb`);
        fields.push(`plan_compiled_at = NULL`);
        fields.push(`plan_compiler_model = NULL`);
      }
      fields.push(`updated_at = now()`);
      const { rows } = await db().query<AutomationRow>(
        `UPDATE automations SET ${fields.join(', ')}
          WHERE id = $1 AND env_id = $2
       RETURNING *`,
        params,
      );
      if (!rows[0]) return reply.code(404).send({ error: 'automation_not_found' });
      return { automation: rows[0] };
    },
  );

  // ---- DELETE /envs/:slug/automations/:id ----------------------------------
  // Cascades to automation_runs via FK ON DELETE CASCADE.
  app.delete<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/automations/:id',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const res = await db().query(
        `DELETE FROM automations WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      if (res.rowCount === 0) return reply.code(404).send({ error: 'automation_not_found' });
      return reply.code(204).send();
    },
  );

  // ---- POST /envs/:slug/automations/:id/pause ------------------------------
  // active → paused. Clears next_run_at so the dispatcher won't pick it up.
  app.post<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/automations/:id/pause',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const { rows } = await db().query<AutomationRow>(
        `UPDATE automations
            SET status = 'paused', next_run_at = NULL, updated_at = now()
          WHERE id = $1 AND env_id = $2 AND status IN ('active', 'draft')
      RETURNING *`,
        [req.params.id, env.id],
      );
      if (!rows[0]) {
        return reply
          .code(404)
          .send({ error: 'automation_not_found_or_not_pauseable' });
      }
      return { automation: rows[0] };
    },
  );

  // ---- POST /envs/:slug/automations/:id/resume -----------------------------
  // paused → active. Computing the actual next_run_at needs the schedule
  // parser (lands with the dispatcher in M8.3). For M8.1 we just flip status
  // and let the dispatcher compute next_run_at on its next tick.
  app.post<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/automations/:id/resume',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const { rows } = await db().query<AutomationRow>(
        `UPDATE automations
            SET status = 'active', updated_at = now()
          WHERE id = $1 AND env_id = $2 AND status = 'paused'
            AND schedule_cron IS NOT NULL
      RETURNING *`,
        [req.params.id, env.id],
      );
      if (!rows[0]) {
        return reply.code(404).send({
          error: 'automation_not_resumeable',
          message:
            'Automation must be paused and have a schedule before it can be resumed.',
        });
      }
      return { automation: rows[0] };
    },
  );

  // ---- POST /envs/:slug/automations/:id/preview ----------------------------
  // 501 stub for M8.1 — needs the compiler (M8.2) + the runner (M8.3).
  // Returns the same shape we'll fill in later so the UI can wire today.
  app.post<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/automations/:id/preview',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const { rows } = await db().query<AutomationRow>(
        `SELECT * FROM automations WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'automation_not_found' });
      return reply.code(501).send({
        error: 'preview_not_yet_implemented',
        message:
          'The compiler + runner land in M8.2 and M8.3. CRUD + UI ship in M8.1.',
        compiled_plan: rows[0].compiled_plan,
      });
    },
  );

  // ---- POST /envs/:slug/automations/:id/run-now ----------------------------
  // 501 stub for M8.1 — needs the runner (M8.3).
  app.post<{ Params: { slug: string; id: string } }>(
    '/envs/:slug/automations/:id/run-now',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, true);
      if (!env) return;
      const { rows } = await db().query<AutomationRow>(
        `SELECT id FROM automations WHERE id = $1 AND env_id = $2`,
        [req.params.id, env.id],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'automation_not_found' });
      return reply.code(501).send({
        error: 'run_now_not_yet_implemented',
        message: 'The runner lands in M8.3.',
      });
    },
  );

  // ---- GET /envs/:slug/automations/:id/runs --------------------------------
  // Paginated run history powering the detail page's "Runs" tab.
  // Default page size 50 — matches the heatmap-strip + visible list shape.
  app.get<{ Params: { slug: string; id: string }; Querystring: { limit?: string; before?: string } }>(
    '/envs/:slug/automations/:id/runs',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, false);
      if (!env) return;
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
      const before = req.query.before;

      const params: unknown[] = [req.params.id, env.id];
      let where = `r.automation_id = $1 AND r.env_id = $2`;
      if (before) {
        params.push(before);
        where += ` AND r.started_at < $${params.length}`;
      }
      params.push(limit);

      const { rows } = await db().query<RunRow>(
        `SELECT r.*
           FROM automation_runs r
          WHERE ${where}
          ORDER BY r.started_at DESC NULLS LAST
          LIMIT $${params.length}`,
        params,
      );
      return { runs: rows };
    },
  );
}
