import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InvestigatorV2Schema, PipelineAgentRefSchema } from '@argus/investigators';
import { SeveritySchema, NotFoundError, ValidationError, AppError } from '@argus/shared';
import { db } from '../db.js';

/**
 * Investigator CRUD. Two definition shapes are tolerated:
 *
 *   v1 (legacy, single-call): the existing YAML-shaped definition with
 *     `checks`/`provider`/`model` embedded. We don't accept v1 over the API;
 *     it's only kept for backward-compat reads.
 *
 *   v2 (pipeline): body validated by `InvestigatorV2Schema`. The route
 *     transactionally writes the investigator row + `pipeline_agents` rows.
 *
 * Per the plan: builtin investigators have a narrower edit surface and cannot
 * be deleted.
 */
export async function registerInvestigatorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/investigators', async () => {
    const result = await db().query(
      `SELECT i.id, i.name, i.description, i.enabled, i.severity_threshold,
              i.source, i.definition_schema_version, i.updated_at,
              COALESCE(pa.c, 0) AS agent_count
       FROM investigators i
       LEFT JOIN (
         SELECT investigator_id, count(*) AS c
         FROM pipeline_agents
         GROUP BY investigator_id
       ) pa ON pa.investigator_id = i.id
       ORDER BY i.name ASC`,
    );
    return { investigators: result.rows };
  });

  app.get('/v1/investigators/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const inv = await db().query('SELECT * FROM investigators WHERE id = $1', [id]);
    if (inv.rowCount === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }

    const agents = await db().query(
      `SELECT pa.agent_id, pa.position, pa.reads_from,
              a.name, a.provider, a.model, a.output_schema_kind, a.source
       FROM pipeline_agents pa
       JOIN agents a ON a.id = pa.agent_id
       WHERE pa.investigator_id = $1
       ORDER BY pa.position ASC`,
      [id],
    );
    return { investigator: inv.rows[0], agents: agents.rows };
  });

  app.post('/v1/investigators', async (req, reply) => {
    const parsed = InvestigatorV2Schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid investigator body', { issues: parsed.error.issues });
    }
    const body = parsed.data;

    await assertLastAgentIsFinding(body.agents.map((a) => a.agent_id));
    await assertAgentIdsExist(body.agents.map((a) => a.agent_id));

    const existing = await db().query('SELECT 1 FROM investigators WHERE id = $1', [body.id]);
    if ((existing.rowCount ?? 0) > 0) {
      throw new AppError({
        code: 'conflict',
        message: `investigator "${body.id}" already exists`,
        status: 409,
      });
    }

    await withTx(async (client) => {
      const def = v2DefinitionJsonb(body);
      await client.query(
        `INSERT INTO investigators
           (id, name, description, definition, enabled,
            severity_threshold, source, definition_schema_version)
         VALUES ($1, $2, $3, $4::jsonb, true, $5, 'user', 2)`,
        [body.id, body.name, body.description, JSON.stringify(def), body.severity_threshold],
      );
      await insertPipelineAgents(client, body.id, body.agents);
    });

    reply.code(201);
    return { investigator_id: body.id };
  });

  // PATCH-like PUT: replaces the pipeline composition + mutable fields. For
  // builtins, structural fields (id, name, description, definition_schema_version,
  // triggers, context) are locked.
  app.put('/v1/investigators/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await db().query<{ source: 'builtin' | 'user' }>(
      'SELECT source FROM investigators WHERE id = $1',
      [id],
    );
    if (current.rowCount === 0) {
      throw new NotFoundError(`investigator "${id}" not found`);
    }
    const isBuiltin = current.rows[0]!.source === 'builtin';

    const PutSchema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
      severity_threshold: SeveritySchema.optional(),
      triggers: InvestigatorV2Schema.shape.triggers.optional(),
      context: InvestigatorV2Schema.shape.context.optional(),
      output: InvestigatorV2Schema.shape.output.optional(),
      agents: z.array(PipelineAgentRefSchema).min(1).optional(),
    });
    const parsed = PutSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid investigator body', { issues: parsed.error.issues });
    }
    const body = parsed.data;

    if (isBuiltin) {
      const locked = ['name', 'description', 'triggers', 'context'] as const;
      for (const key of locked) {
        if (key in body) {
          throw new AppError({
            code: 'forbidden_field',
            message: `field "${key}" is not editable on a builtin investigator`,
            status: 403,
          });
        }
      }
    }

    if (body.agents) {
      await assertLastAgentIsFinding(body.agents.map((a) => a.agent_id));
      await assertAgentIdsExist(body.agents.map((a) => a.agent_id));
    }

    await withTx(async (client) => {
      const inv = await client.query<{ definition: unknown }>(
        `SELECT definition FROM investigators WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const def = (inv.rows[0]!.definition as Record<string, unknown>) ?? {};

      // Merge mutable fields into the v2 definition JSONB.
      const nextDef: Record<string, unknown> = { ...def };
      if (body.triggers) nextDef.triggers = body.triggers;
      if (body.context) nextDef.context = body.context;
      if (body.output) nextDef.output = body.output;
      if (body.severity_threshold) nextDef.severity_threshold = body.severity_threshold;

      const sets: string[] = ['definition = $2::jsonb', 'updated_at = now()'];
      const params: unknown[] = [id, JSON.stringify(nextDef)];
      if (body.name !== undefined) {
        params.push(body.name);
        sets.push(`name = $${params.length}`);
      }
      if (body.description !== undefined) {
        params.push(body.description);
        sets.push(`description = $${params.length}`);
      }
      if (body.enabled !== undefined) {
        params.push(body.enabled);
        sets.push(`enabled = $${params.length}`);
      }
      if (body.severity_threshold !== undefined) {
        params.push(body.severity_threshold);
        sets.push(`severity_threshold = $${params.length}`);
      }
      // Stamp as v2 so subsequent reads know the agents come from pipeline_agents.
      sets.push(`definition_schema_version = 2`);

      await client.query(`UPDATE investigators SET ${sets.join(', ')} WHERE id = $1`, params);

      if (body.agents) {
        await client.query('DELETE FROM pipeline_agents WHERE investigator_id = $1', [id]);
        await insertPipelineAgents(client, id, body.agents);
      }
    });

    reply.code(200);
    return { investigator_id: id };
  });

  app.delete('/v1/investigators/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await db().query<{ source: 'builtin' | 'user' }>(
      'SELECT source FROM investigators WHERE id = $1',
      [id],
    );
    if (current.rowCount === 0) {
      throw new NotFoundError(`investigator "${id}" not found`);
    }
    if (current.rows[0]!.source === 'builtin') {
      throw new AppError({
        code: 'forbidden',
        message: 'builtin investigators cannot be deleted; disable via PUT { enabled: false }',
        status: 403,
      });
    }
    await db().query('DELETE FROM investigators WHERE id = $1', [id]);
    reply.code(204).send();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertAgentIdsExist(agentIds: string[]): Promise<void> {
  const ids = Array.from(new Set(agentIds));
  const rows = await db().query<{ id: string }>(
    'SELECT id FROM agents WHERE id = ANY($1::text[])',
    [ids],
  );
  const found = new Set(rows.rows.map((r) => r.id));
  const missing = ids.filter((i) => !found.has(i));
  if (missing.length > 0) {
    throw new ValidationError(`agent ids not found: ${missing.join(', ')}`, { missing });
  }
}

async function assertLastAgentIsFinding(agentIds: string[]): Promise<void> {
  if (agentIds.length === 0) {
    throw new ValidationError('pipeline must contain at least one agent');
  }
  const lastId = agentIds[agentIds.length - 1]!;
  const earlier = agentIds.slice(0, -1);

  const rows = await db().query<{ id: string; output_schema_kind: 'text' | 'analysis' | 'finding' }>(
    'SELECT id, output_schema_kind FROM agents WHERE id = ANY($1::text[])',
    [Array.from(new Set(agentIds))],
  );
  const byId = new Map(rows.rows.map((r) => [r.id, r.output_schema_kind]));

  const lastKind = byId.get(lastId);
  if (lastKind !== 'finding') {
    throw new ValidationError(
      `last agent "${lastId}" must be of kind 'finding' (got '${lastKind ?? 'unknown'}')`,
    );
  }
  for (const aid of earlier) {
    if (byId.get(aid) === 'finding') {
      throw new ValidationError(
        `non-last agent "${aid}" cannot be of kind 'finding' (only the last agent emits the Finding)`,
      );
    }
  }
}

function v2DefinitionJsonb(body: z.infer<typeof InvestigatorV2Schema>): Record<string, unknown> {
  return {
    id: body.id,
    name: body.name,
    description: body.description,
    triggers: body.triggers,
    context: body.context,
    severity_threshold: body.severity_threshold,
    output: body.output,
    definition_schema_version: 2,
  };
}

async function insertPipelineAgents(
  client: import('pg').PoolClient,
  investigatorId: string,
  agents: z.infer<typeof PipelineAgentRefSchema>[],
): Promise<void> {
  // Normalize positions to 0..N-1 in the order they were submitted. The plan
  // accepts any non-negative integer; we re-pack so dashboards always see
  // dense indices.
  const sorted = agents.slice().sort((a, b) => a.position - b.position);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    await client.query(
      `INSERT INTO pipeline_agents (investigator_id, agent_id, position, reads_from)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [investigatorId, a.agent_id, i, JSON.stringify(a.reads_from)],
    );
  }
}

async function withTx<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
