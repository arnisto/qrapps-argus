import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IngestEventSchema, EventBus } from '@argus/events';
import { loadConfig } from '@argus/shared';
import { db } from '../db.js';

const BatchSchema = z.union([IngestEventSchema, z.array(IngestEventSchema)]);

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  const bus = new EventBus(loadConfig().redisUrl);

  app.addHook('onClose', async () => {
    await bus.close();
  });

  app.post('/v1/events', async (req, reply) => {
    const parsed = BatchSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'validation_error', issues: parsed.error.issues };
    }
    const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    await bus.publish(events.map((e) => ({ ...e, source: e.source ?? { connector_id: 'manual', connector_type: 'manual' } })));
    reply.code(202);
    return { accepted: events.length };
  });

  app.get('/v1/events', async (req) => {
    const q = req.query as { type?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? '100'), 500);
    const params: unknown[] = [];
    let where = '';
    if (q.type) {
      params.push(q.type);
      where = `WHERE event_type = $1`;
    }
    const sql = `SELECT * FROM events ${where} ORDER BY occurred_at DESC LIMIT ${limit}`;
    const result = await db().query(sql, params);
    return { events: result.rows };
  });
}
