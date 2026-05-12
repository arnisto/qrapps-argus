import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import pg from 'pg';
import {
  PostgresConnectorConfigSchema,
  crawlPostgresSchema,
  type CrawledSchema,
} from '@argus/connectors';
import { getProvider, type ProviderId } from '@argus/ai-providers';
import { NotFoundError, ValidationError, AppError } from '@argus/shared';
import { db } from '../db.js';

/**
 * Full CRUD for data-source connectors. v0.2 ships Postgres only (local +
 * cloud variants differ only in `connection.ssl`). Future connector types
 * extend the discriminated union below.
 *
 * `POST /v1/connectors/test` lets the UI verify credentials + the read-only
 * privilege check BEFORE storing them. This is the single most-impactful UX
 * win — without it, users find out at the first poll tick.
 */
export async function registerConnectorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/connectors', async () => {
    const result = await db().query(
      `SELECT id, type, name, enabled,
              last_sync_at, last_error,
              last_test_at, last_test_ok, last_test_error,
              created_at, updated_at
       FROM connectors
       ORDER BY name ASC`,
    );
    return { connectors: result.rows };
  });

  app.get('/v1/connectors/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db().query('SELECT * FROM connectors WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    // Redact the password before serializing back to the client.
    const row = result.rows[0]!;
    const config = row.config as { connection?: { password?: string } } | null;
    if (config?.connection?.password) {
      config.connection.password = '__REDACTED__';
    }
    return { connector: { ...row, config } };
  });

  app.post('/v1/connectors', async (req, reply) => {
    const parsed = ConnectorCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid connector body', { issues: parsed.error.issues });
    }
    const body = parsed.data;
    const id = body.id ?? slugify(body.name);
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new ValidationError(`derived id "${id}" is not a valid slug`);
    }
    const exists = await db().query('SELECT 1 FROM connectors WHERE id = $1', [id]);
    if ((exists.rowCount ?? 0) > 0) {
      throw new AppError({
        code: 'conflict',
        message: `connector "${id}" already exists`,
        status: 409,
      });
    }

    await db().query(
      `INSERT INTO connectors (id, type, name, config, enabled)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [id, body.type, body.name, JSON.stringify(body.config), body.enabled],
    );
    reply.code(201);
    return { connector_id: id };
  });

  app.put('/v1/connectors/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await db().query<{ type: string; config: unknown }>(
      'SELECT type, config FROM connectors WHERE id = $1',
      [id],
    );
    if (current.rowCount === 0) {
      throw new NotFoundError(`connector "${id}" not found`);
    }

    const parsed = ConnectorUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid connector body', { issues: parsed.error.issues });
    }
    const body = parsed.data;

    // If config is provided, validate against the connector's type. The type
    // is immutable on update.
    let nextConfig: unknown = current.rows[0]!.config;
    if (body.config) {
      const validated = validateConfigForType(current.rows[0]!.type, body.config);
      // If the client sent the redacted password placeholder, splice the
      // existing password back in (so users can edit non-secret fields
      // without re-entering the password).
      nextConfig = splicePassword(current.rows[0]!.config, validated);
    }

    const sets: string[] = ['updated_at = now()'];
    const params: unknown[] = [id];
    if (body.name !== undefined) {
      params.push(body.name);
      sets.push(`name = $${params.length}`);
    }
    if (body.enabled !== undefined) {
      params.push(body.enabled);
      sets.push(`enabled = $${params.length}`);
    }
    if (body.config) {
      params.push(JSON.stringify(nextConfig));
      sets.push(`config = $${params.length}::jsonb`);
    }

    await db().query(`UPDATE connectors SET ${sets.join(', ')} WHERE id = $1`, params);
    reply.code(200);
    return { connector_id: id };
  });

  app.delete('/v1/connectors/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const exists = await db().query('SELECT 1 FROM connectors WHERE id = $1', [id]);
    if (exists.rowCount === 0) {
      throw new NotFoundError(`connector "${id}" not found`);
    }
    // CASCADE on connector_cursors handles cursor cleanup.
    await db().query('DELETE FROM connectors WHERE id = $1', [id]);
    reply.code(204).send();
  });

  // ---------- test connection (from form) ----------
  // Validates candidate credentials without storing them. Called by the
  // dashboard form when the user clicks "Run test" on the create/edit form.
  //
  // Quirk: GET redacts the password as "__REDACTED__". When a user edits an
  // existing connector and clicks "Run test" without re-typing the password,
  // the form sends the literal placeholder. If the request body includes
  // `connector_id`, splice in the stored password before running the test
  // (same trick used on PUT).
  app.post('/v1/connectors/test', async (req) => {
    const parsed = ConnectorTestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid test body', { issues: parsed.error.issues });
    }
    const config = await maybeSplicePasswordFromStored(parsed.data);
    return await testPostgresConnection(config);
  });

  // ---------- test a SAVED connector by id ----------
  // The "is this connector currently healthy?" check. Uses the stored config
  // directly (no form values), persists the outcome into last_test_at /
  // last_test_ok / last_test_error so the dashboard can surface it.
  // Independent of `last_sync_at` / `last_error` (those are polling-loop owned).
  app.post('/v1/connectors/:id/test', async (req) => {
    const { id } = req.params as { id: string };
    const row = await db().query<{ type: string; config: PostgresConnectorConfigStored }>(
      'SELECT type, config FROM connectors WHERE id = $1',
      [id],
    );
    if (row.rowCount === 0) {
      throw new NotFoundError(`connector "${id}" not found`);
    }
    if (row.rows[0]!.type !== 'postgres') {
      throw new ValidationError(`connector "${id}" is not a postgres connector`);
    }

    const result = await testPostgresConnection(row.rows[0]!.config);

    await db().query(
      `UPDATE connectors
       SET last_test_at    = now(),
           last_test_ok    = $2,
           last_test_error = $3
       WHERE id = $1`,
      [id, result.ok, result.ok ? null : (result.error ?? buildErrorSummary(result))],
    );

    return result;
  });

  // ---------- schema crawl + LLM description ----------
  // GET returns the latest stored crawl. POST kicks off a fresh crawl,
  // optionally with an LLM description pass at the end.
  app.get('/v1/connectors/:id/schema', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db().query<{
      schema_json: CrawledSchema;
      description: string | null;
      description_at: string | null;
      description_credential_id: string | null;
      crawled_at: string;
      crawl_error: string | null;
    }>(
      `SELECT schema_json, description, description_at, description_credential_id,
              crawled_at, crawl_error
       FROM connector_schemas
       WHERE connector_id = $1`,
      [id],
    );
    if (r.rowCount === 0) {
      reply.code(404);
      return { error: 'not_crawled', message: 'No schema crawl yet. POST /crawl to generate one.' };
    }
    return r.rows[0];
  });

  app.post('/v1/connectors/:id/crawl', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = (req.query ?? {}) as { describe?: string };
    const generateDescription = q.describe !== 'false';

    const connectorRow = await db().query<{
      type: string;
      config: PostgresConnectorConfigStored;
    }>('SELECT type, config FROM connectors WHERE id = $1', [id]);
    if (connectorRow.rowCount === 0) {
      throw new NotFoundError(`connector "${id}" not found`);
    }
    if (connectorRow.rows[0]!.type !== 'postgres') {
      throw new ValidationError(`connector "${id}" is not a postgres connector`);
    }

    let schema: CrawledSchema;
    try {
      schema = await crawlPostgresSchema(connectorRow.rows[0]!.config);
    } catch (e) {
      const message = (e as Error).message;
      await db().query(
        `INSERT INTO connector_schemas (connector_id, schema_json, crawled_at, crawl_error)
         VALUES ($1, '{}'::jsonb, now(), $2)
         ON CONFLICT (connector_id) DO UPDATE
         SET schema_json = EXCLUDED.schema_json,
             crawled_at = EXCLUDED.crawled_at,
             crawl_error = EXCLUDED.crawl_error,
             description = NULL,
             description_at = NULL`,
        [id, message],
      );
      reply.code(502);
      return { ok: false, error: message };
    }

    // Persist the raw schema immediately so the UI can show it even while
    // the LLM description is being generated.
    await db().query(
      `INSERT INTO connector_schemas
         (connector_id, schema_json, crawled_at, crawl_error,
          description, description_at, description_credential_id)
       VALUES ($1, $2::jsonb, now(), NULL, NULL, NULL, NULL)
       ON CONFLICT (connector_id) DO UPDATE
       SET schema_json = EXCLUDED.schema_json,
           crawled_at  = EXCLUDED.crawled_at,
           crawl_error = NULL,
           description = NULL,
           description_at = NULL,
           description_credential_id = NULL`,
      [id, JSON.stringify(schema)],
    );

    let description: string | null = null;
    let credentialUsed: string | null = null;
    if (generateDescription) {
      try {
        const out = await generateSchemaDescription(schema);
        description = out.text;
        credentialUsed = out.credentialId;
        await db().query(
          `UPDATE connector_schemas
           SET description = $2,
               description_at = now(),
               description_credential_id = $3
           WHERE connector_id = $1`,
          [id, description, credentialUsed],
        );
      } catch (e) {
        // Description failure is non-fatal — the schema is still saved.
        description = `(LLM description failed: ${(e as Error).message})`;
      }
    }

    return {
      ok: true,
      schema,
      description,
      tables_crawled: schema.tables.length,
      mapped_tables: schema.mapped_tables,
    };
  });
}

type PostgresConnectorConfigStored = z.infer<typeof PostgresConnectorConfigSchema>;

async function maybeSplicePasswordFromStored(
  body: z.infer<typeof ConnectorTestSchema>,
): Promise<PostgresConnectorConfigStored> {
  const cfg = body.config;
  if (cfg.connection.password !== '__REDACTED__') return cfg;
  if (!body.connector_id) {
    // No connector_id was sent — the placeholder will fail auth, but that's
    // the user-facing signal: "please retype your password to test."
    return cfg;
  }
  const row = await db().query<{ config: PostgresConnectorConfigStored }>(
    'SELECT config FROM connectors WHERE id = $1',
    [body.connector_id],
  );
  const stored = row.rows[0]?.config;
  if (!stored?.connection?.password) return cfg;
  return {
    ...cfg,
    connection: { ...cfg.connection, password: stored.connection.password },
  };
}

function buildErrorSummary(result: {
  ok: boolean;
  writable_tables_violation?: string[];
  mappings?: Array<{ reachable: boolean; error?: string; table?: string }>;
}): string {
  if (result.writable_tables_violation && result.writable_tables_violation.length > 0) {
    return `user has write privileges: ${result.writable_tables_violation.join(', ')}`;
  }
  const unreachable = result.mappings?.filter((m) => !m.reachable) ?? [];
  if (unreachable.length > 0) {
    return unreachable.map((m) => `${m.table}: ${m.error ?? 'unreachable'}`).join('; ');
  }
  return 'unknown test failure';
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PostgresCreateSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  type: z.literal('postgres'),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  config: PostgresConnectorConfigSchema,
});

// Future connector types extend this union.
const ConnectorCreateSchema = z.discriminatedUnion('type', [PostgresCreateSchema]);

const ConnectorUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  config: PostgresConnectorConfigSchema.optional(),
});

const ConnectorTestSchema = z.object({
  type: z.literal('postgres'),
  config: PostgresConnectorConfigSchema,
  /**
   * Optional: when the form is editing an existing connector, the password
   * field carries the "__REDACTED__" placeholder; passing the connector id
   * lets the server splice the stored password back in before testing.
   */
  connector_id: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateConfigForType(type: string, config: unknown): unknown {
  switch (type) {
    case 'postgres':
      return PostgresConnectorConfigSchema.parse(config);
    default:
      throw new ValidationError(`unknown connector type "${type}"`);
  }
}

/** Replace the placeholder password with the stored one (UI doesn't re-send secrets). */
function splicePassword(stored: unknown, incoming: unknown): unknown {
  const s = stored as { connection?: { password?: string } } | null | undefined;
  const i = incoming as { connection?: { password?: string } } | null | undefined;
  if (i?.connection?.password === '__REDACTED__' && s?.connection?.password) {
    i.connection.password = s.connection.password;
  }
  return incoming;
}

/**
 * Open a short-lived pg.Pool with the candidate credentials, run the same
 * read-only privilege check the connector itself enforces, and return a
 * structured success/failure plus per-mapping table reachability.
 */
async function testPostgresConnection(config: z.infer<typeof PostgresConnectorConfigSchema>) {
  const pool = new pg.Pool({
    host: config.connection.host,
    port: config.connection.port,
    database: config.connection.database,
    user: config.connection.user,
    password: config.connection.password,
    ssl: config.connection.ssl ? { rejectUnauthorized: false } : false,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
  });

  try {
    // 1) Can we connect at all?
    const role = await pool.query<{ current_user: string; version: string }>(
      'SELECT current_user, version()',
    );

    // 2) Read-only? Mirror PostgresConnector.assertReadOnly().
    const writePrivs = await pool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = current_user
         AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES')
       LIMIT 5`,
    );

    // 3) Per-mapping: does the table exist + does the cursor column exist?
    const mappingResults = [] as Array<{
      table: string;
      reachable: boolean;
      error?: string;
      row_count_estimate?: number;
    }>;
    for (const mapping of config.mappings) {
      try {
        // Validate identifier format defensively (mirrors connector's ident()).
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(mapping.table)) {
          throw new Error('invalid table identifier');
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(mapping.cursor.column)) {
          throw new Error('invalid cursor column identifier');
        }
        // Use information_schema instead of SELECT * — avoids touching data.
        const col = await pool.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = $1
             AND column_name = $2`,
          [mapping.table, mapping.cursor.column],
        );
        const colExists = (col.rows[0]?.c ?? 0) > 0;
        if (!colExists) {
          throw new Error(`cursor column "${mapping.cursor.column}" not found on table "${mapping.table}"`);
        }
        const stats = await pool.query<{ n: number }>(
          `SELECT n_live_tup::int AS n FROM pg_stat_user_tables
           WHERE schemaname = 'public' AND relname = $1`,
          [mapping.table],
        );
        mappingResults.push({
          table: mapping.table,
          reachable: true,
          row_count_estimate: stats.rows[0]?.n ?? 0,
        });
      } catch (err) {
        mappingResults.push({
          table: mapping.table,
          reachable: false,
          error: (err as Error).message,
        });
      }
    }

    return {
      ok: writePrivs.rowCount === 0 && mappingResults.every((m) => m.reachable),
      current_user: role.rows[0]?.current_user ?? null,
      server_version: role.rows[0]?.version ?? null,
      writable_tables_violation:
        (writePrivs.rowCount ?? 0) > 0
          ? writePrivs.rows.map((r) => `${r.table_name}:${r.privilege_type}`)
          : [],
      mappings: mappingResults,
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
      mappings: [],
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Hand the crawled schema to an LLM and ask it for a one-paragraph narrative
 * description. We pick credentials in priority order:
 *   1. The default Gemini credential (cheapest by token)
 *   2. The default Claude credential
 *   3. The default OpenAI credential
 *   4. Env-var fallback via the registry
 *
 * The schema sent to the model is trimmed: table names, column names+types,
 * row count estimates, FK edges, and up to 2 sample rows per table. Sending
 * the full sample set would blow past Gemini Flash's input budget on big
 * schemas; the trimmed view is informative enough for a description.
 */
async function generateSchemaDescription(
  schema: CrawledSchema,
): Promise<{ text: string; credentialId: string | null }> {
  const cred = await pickDescriberCredential();

  const provider = getProvider(
    cred?.provider as ProviderId | undefined,
    cred?.default_model ?? undefined,
    cred ? { apiKey: cred.api_key_enc, model: cred.default_model ?? undefined } : undefined,
  );

  const prompt = buildSchemaDescriptionPrompt(schema);
  const response = await provider.complete({
    system:
      'You are a senior data engineer. Given a database schema, write a concise narrative (4-8 sentences) explaining what the database appears to track, what the most important tables are, and any obvious entity relationships. Be specific. Avoid generic language. No bullet points.',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    maxTokens: 800,
  });

  return { text: response.text.trim(), credentialId: cred?.id ?? null };
}

async function pickDescriberCredential(): Promise<{
  id: string;
  provider: string;
  api_key_enc: string;
  default_model: string | null;
} | null> {
  const r = await db().query<{
    id: string;
    provider: string;
    api_key_enc: string;
    default_model: string | null;
  }>(
    `SELECT id, provider, api_key_enc, default_model
     FROM llm_credentials
     WHERE is_default = true
     ORDER BY CASE provider
                WHEN 'gemini' THEN 1
                WHEN 'claude' THEN 2
                WHEN 'openai' THEN 3
                ELSE 99
              END
     LIMIT 1`,
  );
  return r.rows[0] ?? null;
}

function buildSchemaDescriptionPrompt(schema: CrawledSchema): string {
  const tablesBlock = schema.tables
    .slice(0, 30) // cap to keep the prompt bounded
    .map((t) => {
      const cols = t.columns
        .slice(0, 12)
        .map((c) => `${c.name}:${c.data_type}${c.nullable ? '?' : ''}`)
        .join(', ');
      const pk = t.primary_key.length ? `  pk(${t.primary_key.join(',')})` : '';
      const fks = t.foreign_keys
        .map((f) => `  fk ${f.column} -> ${f.references_table}.${f.references_column}`)
        .join('\n');
      const sample = t.samples.slice(0, 2).map((row) => '  ' + JSON.stringify(row)).join('\n');
      return [
        `--- ${t.table} (rows≈${t.row_count_estimate.toLocaleString()})`,
        `  cols: ${cols}${t.columns.length > 12 ? ` … +${t.columns.length - 12}` : ''}`,
        pk,
        fks,
        sample ? `  sample:\n${sample}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  return [
    `Database: ${schema.database}`,
    `Server: ${schema.server_version.split(',')[0]}`,
    `Tables in schema (${schema.tables.length}${schema.tables.length > 30 ? ' total; showing top 30 by row count' : ''}):`,
    schema.mapped_tables.length
      ? `Mapped by the connector (highest priority): ${schema.mapped_tables.join(', ')}`
      : '',
    '',
    tablesBlock,
  ]
    .filter(Boolean)
    .join('\n');
}
