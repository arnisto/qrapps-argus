import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AgentCreateSchema, AgentSchema } from '@argus/investigators';
import { NotFoundError, ValidationError, AppError } from '@argus/shared';
import { db } from '../db.js';

/**
 * CRUD for reusable agent definitions. Agents are referenced from
 * `pipeline_agents` by id and are immutable in their identity (id, source)
 * once created. Builtin agents have a narrower edit surface.
 */
export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/agents', async () => {
    const result = await db().query(
      `SELECT id, name, description, provider, model, output_schema_kind,
              source, created_at, updated_at
       FROM agents
       ORDER BY name ASC`,
    );
    return { agents: result.rows };
  });

  app.get('/v1/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db().query('SELECT * FROM agents WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { agent: result.rows[0] };
  });

  app.post('/v1/agents', async (req, reply) => {
    const parsed = AgentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid agent body', { issues: parsed.error.issues });
    }
    const id = parsed.data.id ?? slugify(parsed.data.name);
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new ValidationError(`derived id "${id}" is not a valid slug`);
    }

    const exists = await db().query('SELECT 1 FROM agents WHERE id = $1', [id]);
    if ((exists.rowCount ?? 0) > 0) {
      throw new AppError({ code: 'conflict', message: `agent "${id}" already exists`, status: 409 });
    }

    const result = await db().query(
      `INSERT INTO agents
         (id, name, description, provider, model, system_prompt,
          user_prompt_template, output_schema_kind, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user')
       RETURNING *`,
      [
        id,
        parsed.data.name,
        parsed.data.description ?? null,
        parsed.data.provider,
        parsed.data.model,
        parsed.data.system_prompt,
        parsed.data.user_prompt_template ?? null,
        parsed.data.output_schema_kind,
      ],
    );
    reply.code(201);
    return { agent: result.rows[0] };
  });

  app.put('/v1/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await db().query<{ source: 'builtin' | 'user' }>(
      'SELECT source FROM agents WHERE id = $1',
      [id],
    );
    if (current.rowCount === 0) {
      throw new NotFoundError(`agent "${id}" not found`);
    }

    // For builtins, only a narrow set of fields can change (a "soft edit"
    // surface). The rest of the body, if present, is rejected so users get a
    // clear 403 instead of silently-ignored fields.
    const isBuiltin = current.rows[0]!.source === 'builtin';
    const allowedKeys = isBuiltin
      ? (['description', 'provider', 'model', 'system_prompt', 'user_prompt_template'] as const)
      : ([
          'name',
          'description',
          'provider',
          'model',
          'system_prompt',
          'user_prompt_template',
          'output_schema_kind',
        ] as const);

    const PutSchema = AgentSchema.partial().omit({ id: true, source: true });
    const parsed = PutSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid agent body', { issues: parsed.error.issues });
    }
    const body = parsed.data;

    for (const key of Object.keys(body)) {
      if (!(allowedKeys as readonly string[]).includes(key)) {
        throw new AppError({
          code: 'forbidden_field',
          message: `field "${key}" is not editable on a ${isBuiltin ? 'builtin' : 'user'} agent`,
          status: 403,
        });
      }
    }

    // Build a dynamic UPDATE for the allowed fields that were actually provided.
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const key of allowedKeys) {
      if (key in body && body[key] !== undefined) {
        params.push(body[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) {
      return { agent: (await db().query('SELECT * FROM agents WHERE id = $1', [id])).rows[0] };
    }

    const result = await db().query(
      `UPDATE agents SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      params,
    );
    reply.code(200);
    return { agent: result.rows[0] };
  });

  app.delete('/v1/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await db().query<{ source: 'builtin' | 'user' }>(
      'SELECT source FROM agents WHERE id = $1',
      [id],
    );
    if (current.rowCount === 0) {
      throw new NotFoundError(`agent "${id}" not found`);
    }
    if (current.rows[0]!.source === 'builtin') {
      throw new AppError({
        code: 'forbidden',
        message: 'builtin agents cannot be deleted (disable the investigators that use them instead)',
        status: 403,
      });
    }

    const refs = await db().query<{ investigator_id: string }>(
      'SELECT investigator_id FROM pipeline_agents WHERE agent_id = $1 LIMIT 5',
      [id],
    );
    if ((refs.rowCount ?? 0) > 0) {
      throw new AppError({
        code: 'in_use',
        message: `agent "${id}" is referenced by ${refs.rowCount} pipeline(s)`,
        status: 409,
        meta: { references: refs.rows.map((r) => r.investigator_id) },
      });
    }

    await db().query('DELETE FROM agents WHERE id = $1', [id]);
    reply.code(204).send();
  });
}

/** Lower-case + hyphenate `name`. Mirrors the slug regex in `AgentSchema.id`. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Silence unused-import warning when this file is consumed by tsc.
export const __zodHint = z;
