/**
 * The `db.query` agent tool.
 *
 * Given an env + a connector_id + a SQL string, runs it against the
 * customer's Postgres with three layers of read-only defense:
 *
 *   1. The connector secret is expected to be a SELECT-only role.
 *   2. We open a `SET TRANSACTION READ ONLY` block before the query —
 *      any accidental write at the role level errors out, doesn't commit.
 *   3. A SQL safety guard rejects anything that isn't a single SELECT /
 *      WITH / EXPLAIN statement before we ever touch the DB.
 *
 * Output is truncated to ~8KB serialized so a runaway SELECT can't
 * blow up our prompt or our LLM token budget. The full row count is
 * always returned so the model knows what was truncated.
 */
import pg from 'pg';
import { db } from '../db.js';
import { decryptKey } from '../llm/secret.js';
import type { PgConfig, PgSecret } from '../connectors/adapters/postgres.js';

export interface DbQueryResult {
  ok: boolean;
  /** Stringified rows truncated to ~8KB. Each row separated by newline. */
  rows_text?: string;
  rows_returned?: number;
  rows_total_estimate?: number;
  truncated?: boolean;
  latency_ms?: number;
  error?: string;
}

const MAX_BYTES = 8 * 1024;
const STMT_TIMEOUT_MS = 5_000;

/** Cheap surface-level guard. The READ ONLY transaction is the real fence. */
function isReadOnlyStatement(sql: string): boolean {
  const trimmed = sql.replace(/\s+/g, ' ').trim();
  if (!trimmed) return false;
  // Reject multi-statement (only one trailing semicolon allowed).
  const withoutTrailing = trimmed.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) return false;
  const head = withoutTrailing.slice(0, 12).toUpperCase();
  return (
    head.startsWith('SELECT ') ||
    head.startsWith('SELECT(') ||
    head.startsWith('WITH ') ||
    head.startsWith('EXPLAIN ')
  );
}

function rowsToText(rows: Array<Record<string, unknown>>): {
  text: string;
  returned: number;
  truncated: boolean;
} {
  if (rows.length === 0) {
    return { text: '(query returned no rows)', returned: 0, truncated: false };
  }
  const headers = Object.keys(rows[0]!);
  const lines: string[] = [headers.join('\t')];
  let bytes = lines[0]!.length;
  let returned = 0;
  for (const row of rows) {
    const line = headers
      .map((h) => {
        const v = (row as Record<string, unknown>)[h];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'object') return JSON.stringify(v);
        if (v instanceof Date) return (v as Date).toISOString();
        const s = String(v);
        return s.length > 80 ? s.slice(0, 80) + '…' : s;
      })
      .join('\t');
    if (bytes + line.length + 1 > MAX_BYTES) {
      return { text: lines.join('\n'), returned, truncated: true };
    }
    lines.push(line);
    bytes += line.length + 1;
    returned += 1;
  }
  return { text: lines.join('\n'), returned, truncated: false };
}

interface ConnectorRow {
  config: PgConfig;
  secret_ct: Buffer;
  secret_iv: Buffer;
  subtype: string;
}

export async function runQueryViaConnector(
  envId: string,
  connectorId: string,
  sql: string,
): Promise<DbQueryResult> {
  if (!isReadOnlyStatement(sql)) {
    return { ok: false, error: 'rejected_by_safety_guard (only single SELECT/WITH/EXPLAIN allowed)' };
  }
  const { rows } = await db().query<ConnectorRow>(
    `SELECT config, secret_ct, secret_iv, subtype
       FROM env_connectors
      WHERE id = $1 AND env_id = $2 AND enabled
      LIMIT 1`,
    [connectorId, envId],
  );
  const conn = rows[0];
  if (!conn) return { ok: false, error: 'connector_not_found' };
  if (conn.subtype !== 'postgres') {
    return { ok: false, error: `connector_subtype_${conn.subtype}_not_supported_for_db_query` };
  }

  const cfg = conn.config;
  const sec = JSON.parse(decryptKey({ ct: conn.secret_ct, iv: conn.secret_iv })) as PgSecret;

  // Mirror the SSL semantics of postgres.ts (require → verified TLS).
  const sslOpt =
    cfg.ssl === 'disable' ? false
    : cfg.ssl === 'require' ? { rejectUnauthorized: true }
    : undefined;

  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: sec.password,
    ssl: sslOpt,
    statement_timeout: STMT_TIMEOUT_MS,
    connectionTimeoutMillis: 4_000,
  });

  const t0 = Date.now();
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    const res = await client.query(sql);
    await client.query('ROLLBACK'); // close cleanly
    const summary = rowsToText(res.rows as Array<Record<string, unknown>>);
    return {
      ok: true,
      rows_text: summary.text,
      rows_returned: summary.returned,
      rows_total_estimate: res.rows.length,
      truncated: summary.truncated,
      latency_ms: Date.now() - t0,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message, latency_ms: Date.now() - t0 };
  } finally {
    await client.end().catch(() => {});
  }
}
