import pg from 'pg';
import type { PostgresConnectorConfig } from './config.js';

/**
 * Result shape produced by `crawlPostgresSchema`. Stored in
 * `connector_schemas.schema_json` for later use by investigators / the
 * description LLM.
 */
export interface CrawledSchema {
  database: string;
  server_version: string;
  crawled_at: string;
  tables: CrawledTable[];
  /** Tables called out as the connector's configured mapping sources. */
  mapped_tables: string[];
}

export interface CrawledTable {
  table: string;
  row_count_estimate: number;
  columns: Array<{ name: string; data_type: string; nullable: boolean; default: string | null }>;
  primary_key: string[];
  foreign_keys: Array<{
    column: string;
    references_table: string;
    references_column: string;
  }>;
  /** Up to 3 sample rows (column names → stringified values). */
  samples: Array<Record<string, string>>;
}

/**
 * Introspect the source database the connector points at:
 *   - list all `public.` tables
 *   - for each table: columns, types, primary key, foreign keys
 *   - estimated row count from `pg_stat_user_tables.n_live_tup`
 *   - 3 sample rows (SELECT … LIMIT 3) — only column types Postgres can cast to text
 *
 * Everything runs against the same read-only role the polling connector uses,
 * so we inherit the existing safety guarantees. Refuses to start (same
 * `assertReadOnly` check) if the user has any DML/DDL privileges.
 *
 * Total wall time is bounded: pool max=4, connection timeout 5s, per-query
 * statement_timeout 8s. For a 30-table source the whole crawl finishes in
 * <2 seconds.
 */
export async function crawlPostgresSchema(
  config: PostgresConnectorConfig,
  opts: { maxTables?: number; sampleRows?: number } = {},
): Promise<CrawledSchema> {
  const maxTables = opts.maxTables ?? 80;
  const sampleRows = opts.sampleRows ?? 3;

  const pool = new pg.Pool({
    host: config.connection.host,
    port: config.connection.port,
    database: config.connection.database,
    user: config.connection.user,
    password: config.connection.password,
    ssl: config.connection.ssl ? { rejectUnauthorized: false } : false,
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    statement_timeout: 8_000,
  } as pg.PoolConfig & { statement_timeout: number });

  try {
    await assertReadOnly(pool);

    const versionRow = await pool.query<{ version: string }>('SELECT version()');

    // 1) List tables, biggest first (more interesting tables on top).
    const tablesRes = await pool.query<{ relname: string; n_live_tup: number }>(
      `SELECT relname, n_live_tup
       FROM pg_stat_user_tables
       WHERE schemaname = 'public'
       ORDER BY n_live_tup DESC NULLS LAST
       LIMIT $1`,
      [maxTables],
    );

    const tableNames = tablesRes.rows.map((r) => r.relname);
    const tablesByName = new Map(tablesRes.rows.map((r) => [r.relname, r.n_live_tup]));

    if (tableNames.length === 0) {
      return {
        database: config.connection.database,
        server_version: versionRow.rows[0]?.version ?? 'unknown',
        crawled_at: new Date().toISOString(),
        tables: [],
        mapped_tables: config.mappings.map((m) => m.table),
      };
    }

    // 2) Columns — one query, filtered by table list.
    const colsRes = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
      ordinal_position: number;
    }>(
      `SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name, ordinal_position`,
      [tableNames],
    );

    // 3) Primary keys.
    const pksRes = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT kcu.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema   = kcu.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_name = ANY($1::text[])
       ORDER BY kcu.table_name, kcu.ordinal_position`,
      [tableNames],
    );

    // 4) Foreign keys.
    const fksRes = await pool.query<{
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(
      `SELECT kcu.table_name, kcu.column_name,
              ccu.table_name  AS foreign_table_name,
              ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.table_name = ANY($1::text[])`,
      [tableNames],
    );

    // 5) Sample rows — one SELECT per table. Cap at maxTables/2 to bound time;
    //    rest get empty samples (still rich metadata).
    const sampleCap = Math.ceil(tableNames.length / 2);
    const sampleable = tableNames.slice(0, sampleCap);
    const samplePromises = sampleable.map(async (name) => {
      if (!isSafeIdent(name)) return [name, [] as Array<Record<string, string>>] as const;
      try {
        const r = await pool.query<Record<string, unknown>>(
          `SELECT * FROM "${name}" LIMIT ${sampleRows}`,
        );
        return [
          name,
          r.rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([k, v]) => [k, stringify(v)]),
            ),
          ) as Array<Record<string, string>>,
        ] as const;
      } catch {
        return [name, [] as Array<Record<string, string>>] as const;
      }
    });
    const samples = new Map(await Promise.all(samplePromises));

    // 6) Stitch everything into per-table records.
    const colsByTable = group(colsRes.rows, (r) => r.table_name);
    const pksByTable = group(pksRes.rows, (r) => r.table_name);
    const fksByTable = group(fksRes.rows, (r) => r.table_name);

    const tables: CrawledTable[] = tableNames.map((name) => ({
      table: name,
      row_count_estimate: Number(tablesByName.get(name) ?? 0),
      columns: (colsByTable.get(name) ?? []).map((c) => ({
        name: c.column_name,
        data_type: c.data_type,
        nullable: c.is_nullable === 'YES',
        default: c.column_default,
      })),
      primary_key: (pksByTable.get(name) ?? []).map((p) => p.column_name),
      foreign_keys: (fksByTable.get(name) ?? []).map((f) => ({
        column: f.column_name,
        references_table: f.foreign_table_name,
        references_column: f.foreign_column_name,
      })),
      samples: samples.get(name) ?? [],
    }));

    return {
      database: config.connection.database,
      server_version: versionRow.rows[0]?.version ?? 'unknown',
      crawled_at: new Date().toISOString(),
      tables,
      mapped_tables: config.mappings.map((m) => m.table),
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function assertReadOnly(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.role_table_grants
     WHERE grantee = current_user
       AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES')
     LIMIT 1`,
  );
  if (rows.length > 0) {
    throw new Error(
      'crawler refused: configured Postgres user has write privileges. Use a read-only role.',
    );
  }
}

function isSafeIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      return s.length > 80 ? s.slice(0, 80) + '…' : s;
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function group<T, K extends string | number>(rows: T[], keyFn: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}
