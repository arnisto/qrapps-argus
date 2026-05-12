import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';

export async function registerFindingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/findings', async (req) => {
    const q = req.query as { severity?: string; investigator_id?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? '100'), 500);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (q.severity) {
      params.push(q.severity);
      conditions.push(`severity = $${params.length}`);
    }
    if (q.investigator_id) {
      params.push(q.investigator_id);
      conditions.push(`investigator_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT id, investigator_id, severity, summary, evidence, recommendation, impact_estimate, created_at
      FROM findings
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    const result = await db().query(sql, params);
    return { findings: result.rows };
  });

  app.get('/v1/findings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db().query('SELECT * FROM findings WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { finding: result.rows[0] };
  });
}
