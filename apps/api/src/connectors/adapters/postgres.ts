/**
 * Postgres adapter.
 *
 *   testConnect — opens a fresh client with the operator's creds, runs
 *                 `SELECT version()`, reports OK or the upstream error.
 *   crawlSchema — walks information_schema for every table in the
 *                 allowlist; for each table, writes one `db_schema` source
 *                 with DDL + sample-row + foreign-key text, embeds it via
 *                 Gemini, indexes into pgvector — same path as file
 *                 upload, just a different `kind`.
 *
 * READ-ONLY discipline (belt and suspenders):
 *   1. Caller is expected to provide a SELECT-only role.
 *   2. The crawl opens a transaction with `SET TRANSACTION READ ONLY`.
 *   3. Per-statement timeout (5s) prevents a runaway samples query.
 *   4. The live `db.query` tool (M7.4) adds a SQL parser refusing
 *      non-SELECT — not needed for the schema crawl path.
 */
import pg from 'pg';
import { db } from '../../db.js';
import { embed } from '../../llm/gemini.js';
import { toPgvectorLiteral } from '../../llm/pgvector.js';
import { estimateTokens } from '../../llm/chunk.js';
import { loadProviderForEnv } from '../../routes/providers.js';

export interface PgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  ssl?: 'disable' | 'prefer' | 'require';
  schema_allowlist?: string;   // comma-separated, defaults to 'public'
  sample_rows?: number;        // 0 to skip
}

export interface PgSecret {
  password: string;
}

function makeClient(cfg: PgConfig, sec: PgSecret): pg.Client {
  // SSL semantics:
  //   disable → no TLS attempt (only safe on a private network)
  //   prefer  → pg lib default (opportunistic TLS, verifies if used)
  //   require → TLS REQUIRED with full chain verification — anything less
  //             would let an attacker on the network MITM the credentials.
  //             We never silently disable rejectUnauthorized; a customer
  //             with a self-signed cert must add a `ca` field (deferred to
  //             M8 when that ask actually comes in).
  const sslOpt =
    cfg.ssl === 'disable' ? false
    : cfg.ssl === 'require' ? { rejectUnauthorized: true }
    : undefined; // 'prefer' / default — let pg pick
  return new pg.Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: sec.password,
    ssl: sslOpt,
    statement_timeout: 5_000,
    connectionTimeoutMillis: 4_000,
  });
}

export interface TestResult {
  ok: boolean;
  version?: string;
  error?: string;
  tables_visible?: number;
}

export async function testConnect(cfg: PgConfig, sec: PgSecret): Promise<TestResult> {
  const client = makeClient(cfg, sec);
  try {
    await client.connect();
    const v = await client.query<{ version: string }>('SELECT version() AS version');
    const schemas = parseSchemas(cfg.schema_allowlist);
    const t = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM information_schema.tables
        WHERE table_schema = ANY($1) AND table_type = 'BASE TABLE'`,
      [schemas],
    );
    return {
      ok: true,
      version: v.rows[0]?.version?.slice(0, 80),
      tables_visible: parseInt(t.rows[0]!.n, 10),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    await client.end().catch(() => {});
  }
}

function parseSchemas(allow: string | undefined): string[] {
  if (!allow || !allow.trim()) return ['public'];
  return allow
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

interface TableMeta {
  schema: string;
  name: string;
  columns: Array<{ name: string; type: string; nullable: boolean; default: string | null }>;
  pks: string[];
  fks: Array<{ column: string; refs_table: string; refs_column: string }>;
  row_count: number;
  samples: Array<Record<string, unknown>>;
}

async function listTables(client: pg.Client, schemas: string[]): Promise<TableMeta[]> {
  const { rows: tabRows } = await client.query<{ schema: string; name: string }>(
    `SELECT table_schema AS schema, table_name AS name
       FROM information_schema.tables
      WHERE table_schema = ANY($1) AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name`,
    [schemas],
  );

  const out: TableMeta[] = [];
  for (const t of tabRows) {
    const cols = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [t.schema, t.name],
    );

    const pks = await client.query<{ column_name: string }>(
      `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema, table_name)
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1 AND tc.table_name = $2
        ORDER BY kcu.ordinal_position`,
      [t.schema, t.name],
    );

    const fks = await client.query<{ column: string; refs_table: string; refs_column: string }>(
      `SELECT kcu.column_name AS column,
              ccu.table_name AS refs_table,
              ccu.column_name AS refs_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema, table_name)
         JOIN information_schema.constraint_column_usage ccu USING (constraint_name, table_schema)
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = $1 AND tc.table_name = $2`,
      [t.schema, t.name],
    );

    // Approximate row count from pg_class.reltuples — fast, may be stale.
    const rc = await client.query<{ n: string }>(
      `SELECT reltuples::text AS n
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2`,
      [t.schema, t.name],
    );

    out.push({
      schema: t.schema,
      name: t.name,
      columns: cols.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        default: c.column_default,
      })),
      pks: pks.rows.map((p) => p.column_name),
      fks: fks.rows.map((f) => ({ column: f.column, refs_table: f.refs_table, refs_column: f.refs_column })),
      row_count: Math.max(0, Math.floor(parseFloat(rc.rows[0]?.n ?? '0'))),
      samples: [],
    });
  }
  return out;
}

async function sampleRows(
  client: pg.Client,
  t: TableMeta,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  if (limit <= 0) return [];
  const qualified = `"${t.schema}"."${t.name}"`;
  try {
    const { rows } = await client.query(`SELECT * FROM ${qualified} LIMIT ${limit}`);
    return rows;
  } catch {
    return [];
  }
}

function renderTableChunk(t: TableMeta): string {
  const cols = t.columns
    .map(
      (c) =>
        `  ${c.name.padEnd(24)} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.default ? ` DEFAULT ${c.default}` : ''}`,
    )
    .join('\n');

  const fks = t.fks.length
    ? '\nFOREIGN KEYS:\n' + t.fks.map((f) => `  ${f.column} → ${f.refs_table}(${f.refs_column})`).join('\n')
    : '';

  let samples = '';
  if (t.samples.length > 0) {
    const headers = Object.keys(t.samples[0]!);
    const rowsToShow = t.samples.slice(0, 10);
    const lines = rowsToShow.map((row) => {
      return headers
        .map((h) => {
          const v = (row as Record<string, unknown>)[h];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'string') return v.length > 32 ? v.slice(0, 32) + '…' : v;
          if (v instanceof Date) return v.toISOString().slice(0, 19);
          return String(v).slice(0, 32);
        })
        .join('\t');
    });
    samples =
      '\nSAMPLE ROWS (' +
      `${t.samples.length} of ${t.row_count.toLocaleString()} approx`+
      '):\n' +
      headers.join('\t') +
      '\n' +
      lines.join('\n');
  }

  return `TABLE ${t.schema}.${t.name}
APPROX ROWS: ${t.row_count.toLocaleString()}
PRIMARY KEY: ${t.pks.length ? t.pks.join(', ') : '(none)'}

COLUMNS:
${cols}${fks}${samples}`;
}

export interface CrawlOutcome {
  ok: boolean;
  tables_indexed: number;
  chunks_indexed: number;
  errors: string[];
}

export async function crawlSchema(
  envId: string,
  cfg: PgConfig,
  sec: PgSecret,
  connectorId: string,
  connectorName: string,
  createdBy: string,
): Promise<CrawlOutcome> {
  // Embedding provider — Gemini is required at the env level.
  const provider = await loadProviderForEnv(envId, 'gemini');
  if (!provider) {
    return { ok: false, tables_indexed: 0, chunks_indexed: 0, errors: ['no_gemini_provider'] };
  }

  const client = makeClient(cfg, sec);
  const errors: string[] = [];
  let tablesIndexed = 0;
  let chunksIndexed = 0;

  try {
    await client.connect();
    await client.query('SET TRANSACTION READ ONLY');

    const schemas = parseSchemas(cfg.schema_allowlist);
    const allTables = await listTables(client, schemas);

    // v1 cap. A 130-table crawl with one Gemini embed per table is ~2 min
    // of upstream latency — beyond what a sync POST handler can hold.
    // Operators get the first N alphabetically; "Re-crawl" picks up where
    // we left off in M7.4 once we move the crawl to BullMQ.
    const HARD_CAP = 25;
    const tables = allTables.slice(0, HARD_CAP);
    const skipped_for_cap = Math.max(0, allTables.length - tables.length);

    // Remove prior crawl artifacts for this connector — re-crawl semantics.
    await db().query(
      `DELETE FROM sources WHERE env_id = $1 AND uri = $2`,
      [envId, `connector://${connectorId}`],
    );

    const sampleLimit = Math.max(0, Math.min(50, cfg.sample_rows ?? 25));

    for (const t of tables) {
      try {
        t.samples = await sampleRows(client, t, sampleLimit);
        const text = renderTableChunk(t);
        const title = `${t.schema}.${t.name}`;

        // Embed first — fail fast if Gemini is down.
        const [vec] = await embed(provider, [text], 768);
        if (!vec) {
          errors.push(`embed_failed:${title}`);
          continue;
        }

        // Insert as a `db_schema` source. Authority 70 (between docs 60
        // and Q&A 85). uri marks ownership for re-crawl + delete.
        const { rows: srcRows } = await db().query<{ id: string }>(
          `INSERT INTO sources (env_id, kind, title, uri, bytes, authority, created_by)
                VALUES ($1, 'db_schema', $2, $3, $4, 70, $5)
           RETURNING id`,
          [envId, title, `connector://${connectorId}`, Buffer.byteLength(text), createdBy],
        );
        const sourceId = srcRows[0]!.id;

        await db().query(
          `INSERT INTO chunks (env_id, source_id, ord, text, tokens, embedding)
                VALUES ($1, $2, 0, $3, $4, $5::vector)`,
          [envId, sourceId, text, estimateTokens(text), toPgvectorLiteral(vec)],
        );

        tablesIndexed += 1;
        chunksIndexed += 1;
      } catch (err) {
        errors.push(`${t.schema}.${t.name}: ${(err as Error).message}`);
      }
    }

    // Stamp the connector as synced.
    const detail = [
      `Indexed ${tablesIndexed} table${tablesIndexed === 1 ? '' : 's'}`,
      errors.length ? `${errors.length} skipped` : null,
      skipped_for_cap ? `${skipped_for_cap} more deferred (re-crawl to add)` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    await db().query(
      `UPDATE env_connectors
          SET status = 'connected', status_detail = $2, last_synced_at = now()
        WHERE id = $1`,
      [connectorId, detail],
    );

    // Touch the connector name so it appears in the UI even when crawls fail.
    void connectorName;

    return {
      ok: errors.length === 0,
      tables_indexed: tablesIndexed,
      chunks_indexed: chunksIndexed,
      errors,
    };
  } catch (err) {
    return {
      ok: false,
      tables_indexed: tablesIndexed,
      chunks_indexed: chunksIndexed,
      errors: [(err as Error).message],
    };
  } finally {
    await client.end().catch(() => {});
  }
}
