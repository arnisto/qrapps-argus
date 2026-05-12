import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { testCredential } from '@argus/ai-providers';
import { NotFoundError, ValidationError, AppError } from '@argus/shared';
import { db } from '../db.js';

/**
 * LLM credential CRUD. Lets users manage their own provider API keys via the
 * dashboard instead of editing `.env` and restarting the stack.
 *
 *   GET    /v1/llm-credentials             list (api_key redacted)
 *   GET    /v1/llm-credentials/:id         detail (api_key redacted)
 *   POST   /v1/llm-credentials             create
 *   PUT    /v1/llm-credentials/:id         update (placeholder pw splice)
 *   DELETE /v1/llm-credentials/:id         remove (404 if referenced by agents)
 *   POST   /v1/llm-credentials/test        validate a candidate key
 *   POST   /v1/llm-credentials/:id/test    validate a STORED credential
 *   POST   /v1/llm-credentials/:id/default mark this row as the default for its provider
 *
 * `is_default` is enforced at most one true per provider — the POST/PUT
 * paths flip other rows to false transactionally when a new default lands.
 */
export async function registerLlmCredentialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/llm-credentials', async () => {
    const r = await db().query(
      `SELECT id, name, provider, default_model, is_default, notes,
              last_test_at, last_test_ok, last_test_error,
              created_at, updated_at
       FROM llm_credentials
       ORDER BY provider ASC, name ASC`,
    );
    return { credentials: r.rows };
  });

  app.get('/v1/llm-credentials/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db().query(
      `SELECT id, name, provider, default_model, is_default, notes,
              last_test_at, last_test_ok, last_test_error,
              created_at, updated_at,
              '__REDACTED__'::text AS api_key
       FROM llm_credentials WHERE id = $1`,
      [id],
    );
    if (r.rowCount === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { credential: r.rows[0] };
  });

  app.post('/v1/llm-credentials', async (req, reply) => {
    const parsed = CredCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid credential body', { issues: parsed.error.issues });
    }
    const body = parsed.data;
    const id = body.id ?? slugify(`${body.provider}-${body.name}`);
    if (!/^[a-z][a-z0-9._-]*$/.test(id)) {
      throw new ValidationError(`derived id "${id}" is not a valid slug`);
    }
    const exists = await db().query('SELECT 1 FROM llm_credentials WHERE id = $1', [id]);
    if ((exists.rowCount ?? 0) > 0) {
      throw new AppError({
        code: 'conflict',
        message: `credential "${id}" already exists`,
        status: 409,
      });
    }

    await withTx(async (client) => {
      if (body.is_default) {
        await client.query(
          `UPDATE llm_credentials SET is_default = false WHERE provider = $1`,
          [body.provider],
        );
      }
      await client.query(
        `INSERT INTO llm_credentials
           (id, name, provider, api_key_enc, default_model, is_default, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          body.name,
          body.provider,
          body.api_key,
          body.default_model ?? null,
          body.is_default ?? false,
          body.notes ?? null,
        ],
      );
    });

    reply.code(201);
    return { credential_id: id };
  });

  app.put('/v1/llm-credentials/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await db().query<{ api_key_enc: string; provider: string }>(
      `SELECT api_key_enc, provider FROM llm_credentials WHERE id = $1`,
      [id],
    );
    if (current.rowCount === 0) {
      throw new NotFoundError(`credential "${id}" not found`);
    }

    const parsed = CredUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid credential body', { issues: parsed.error.issues });
    }
    const body = parsed.data;

    // If the client sent the placeholder, keep the stored key.
    const apiKey =
      body.api_key === '__REDACTED__' ? current.rows[0]!.api_key_enc : body.api_key;

    await withTx(async (client) => {
      if (body.is_default === true) {
        await client.query(
          `UPDATE llm_credentials SET is_default = false WHERE provider = $1 AND id <> $2`,
          [current.rows[0]!.provider, id],
        );
      }
      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [id];
      const set = (col: string, val: unknown) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (body.name !== undefined) set('name', body.name);
      if (apiKey !== undefined) set('api_key_enc', apiKey);
      if (body.default_model !== undefined) set('default_model', body.default_model);
      if (body.is_default !== undefined) set('is_default', body.is_default);
      if (body.notes !== undefined) set('notes', body.notes);
      await client.query(
        `UPDATE llm_credentials SET ${sets.join(', ')} WHERE id = $1`,
        params,
      );
    });

    reply.code(200);
    return { credential_id: id };
  });

  app.delete('/v1/llm-credentials/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const refs = await db().query(
      `SELECT count(*)::int AS n FROM agents WHERE credential_id = $1`,
      [id],
    );
    if ((refs.rows[0]?.n ?? 0) > 0) {
      throw new AppError({
        code: 'in_use',
        message: `credential is referenced by ${refs.rows[0]!.n} agent(s); detach first`,
        status: 409,
      });
    }
    const r = await db().query('DELETE FROM llm_credentials WHERE id = $1', [id]);
    if ((r.rowCount ?? 0) === 0) {
      throw new NotFoundError(`credential "${id}" not found`);
    }
    reply.code(204).send();
  });

  // ---------- test a candidate key (no DB persistence) ----------
  app.post('/v1/llm-credentials/test', async (req) => {
    const parsed = CredTestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid test body', { issues: parsed.error.issues });
    }
    const body = parsed.data;
    const apiKey =
      body.api_key === '__REDACTED__' && body.id
        ? (
            await db().query<{ api_key_enc: string }>(
              'SELECT api_key_enc FROM llm_credentials WHERE id = $1',
              [body.id],
            )
          ).rows[0]?.api_key_enc
        : body.api_key;
    if (!apiKey) {
      return { ok: false, error: 'no api key provided' };
    }
    return await testCredential({
      provider: body.provider,
      apiKey,
      ...(body.model ? { model: body.model } : {}),
    });
  });

  // ---------- test a SAVED credential ----------
  app.post('/v1/llm-credentials/:id/test', async (req) => {
    const { id } = req.params as { id: string };
    const r = await db().query<{ provider: string; api_key_enc: string; default_model: string | null }>(
      'SELECT provider, api_key_enc, default_model FROM llm_credentials WHERE id = $1',
      [id],
    );
    if (r.rowCount === 0) {
      throw new NotFoundError(`credential "${id}" not found`);
    }
    const row = r.rows[0]!;
    const result = await testCredential({
      provider: row.provider as Parameters<typeof testCredential>[0]['provider'],
      apiKey: row.api_key_enc,
      ...(row.default_model ? { model: row.default_model } : {}),
    });
    await db().query(
      `UPDATE llm_credentials
       SET last_test_at = now(), last_test_ok = $2, last_test_error = $3
       WHERE id = $1`,
      [id, result.ok, result.ok ? null : (result.error ?? null)],
    );
    return result;
  });
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ProviderEnum = z.enum(['claude', 'openai', 'gemini', 'ollama', 'deepseek', 'mock']);

const CredCreateSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]*$/).optional(),
  name: z.string().min(1),
  provider: ProviderEnum,
  api_key: z.string().min(1),
  default_model: z.string().optional(),
  is_default: z.boolean().optional(),
  notes: z.string().optional(),
});

const CredUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  api_key: z.string().min(1).optional(),
  default_model: z.string().optional(),
  is_default: z.boolean().optional(),
  notes: z.string().optional(),
});

const CredTestSchema = z.object({
  provider: ProviderEnum,
  api_key: z.string().min(1),
  model: z.string().optional(),
  /** Optional — when set and api_key is "__REDACTED__", splice from the stored row. */
  id: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function withTx<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
