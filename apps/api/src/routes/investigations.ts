import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@argus/shared';
import { db } from '../db.js';

/**
 * Read-only endpoints for inspecting investigations and their reasoning trail.
 *
 * The dashboard's reasoning timeline component is the primary consumer:
 *   GET /v1/investigations?finding_id=<id>  → resolves finding → investigation
 *   GET /v1/investigations/:id/reasoning   → full agent_runs trail
 */
export async function registerInvestigationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/investigations', async (req, reply) => {
    const q = req.query as { finding_id?: string; limit?: string };

    if (q.finding_id) {
      const row = await db().query<{ investigation_id: string }>(
        `SELECT investigation_id FROM findings WHERE id = $1`,
        [q.finding_id],
      );
      if (row.rowCount === 0) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return { investigation_id: row.rows[0]!.investigation_id };
    }

    const limit = Math.min(Number(q.limit ?? '50'), 200);
    const result = await db().query(
      `SELECT id, investigator_id, status, started_at, finished_at,
              provider, model, tokens_input, tokens_output, error
       FROM investigations
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit],
    );
    return { investigations: result.rows };
  });

  app.get('/v1/investigations/:id/reasoning', async (req, reply) => {
    const { id } = req.params as { id: string };

    const invRow = await db().query(
      `SELECT id, investigator_id, status, started_at, finished_at,
              triggered_by, provider, model, tokens_input, tokens_output, error
       FROM investigations
       WHERE id = $1`,
      [id],
    );
    if (invRow.rowCount === 0) {
      throw new NotFoundError(`investigation "${id}" not found`);
    }

    const runsRow = await db().query(
      `SELECT ar.id, ar.agent_id, a.name AS agent_name, ar.position, ar.status,
              ar.started_at, ar.finished_at, ar.provider, ar.model,
              ar.system_prompt_rendered, ar.user_prompt_rendered,
              ar.output_json, ar.output_text,
              ar.tokens_input, ar.tokens_output, ar.error
       FROM agent_runs ar
       LEFT JOIN agents a ON a.id = ar.agent_id
       WHERE ar.investigation_id = $1
       ORDER BY ar.position ASC`,
      [id],
    );

    reply.code(200);
    return { investigation: invRow.rows[0], agent_runs: runsRow.rows };
  });
}
