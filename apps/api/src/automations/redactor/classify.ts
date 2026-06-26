/**
 * Classifier — the persistent layer of the hybrid classifier.
 *
 * Two ingress paths into `column_classifications`:
 *
 *   1. CRAWL-TIME (`crawlClassifyConnector`) — called when a db-kind
 *      env_connector is enabled. Walks information_schema.columns; for
 *      each column, runs the name classifier; if `safe`, samples up to
 *      N values and runs the value classifier. Upserts {label,
 *      source='auto', sample_confidence}.
 *
 *   2. OPERATOR OVERRIDE — POST /envs/:slug/env-connectors/:id/classifications
 *      writes rows with `source='operator'`. Override wins over `auto`
 *      via the (connector_id, schema, table, column) UNIQUE + the read
 *      path's ordering.
 *
 * The lookup helper `loadClassificationsForConnector` is what the
 * redactor calls per run. It returns a Map keyed by `schema.table.column`
 * for O(1) lookup during SQL rewrite + cell masking.
 */
import { db } from '../../db.js';
import type { Client, PoolClient } from 'pg';
import { classifyByName, classifyByValue, type Label } from './rules.js';

const CRAWL_SAMPLE_SIZE = 25;
const CRAWL_PER_COLUMN_TIMEOUT_MS = 1_500;

export interface ColumnClassification {
  schema: string;
  table: string;
  column: string;
  label: Label;
  source: 'auto' | 'operator';
  sample_confidence: number | null;
}

/**
 * Key for the in-memory map: "schema.table.column" all lowercased.
 */
function key(schema: string, table: string, column: string): string {
  return `${schema.toLowerCase()}.${table.toLowerCase()}.${column.toLowerCase()}`;
}

export class ClassificationMap {
  private readonly map = new Map<string, ColumnClassification>();

  constructor(rows: ColumnClassification[]) {
    // Operator overrides win — insert auto first, then operator stomps.
    for (const r of rows.filter((r) => r.source === 'auto')) {
      this.map.set(key(r.schema, r.table, r.column), r);
    }
    for (const r of rows.filter((r) => r.source === 'operator')) {
      this.map.set(key(r.schema, r.table, r.column), r);
    }
  }

  /**
   * Look up a fully-qualified column. Falls back to NAME-based runtime
   * classification if the column isn't in `column_classifications` yet
   * (e.g. a fresh connector, an alias in the SELECT list, a subquery
   * projection). The runtime fallback is conservative — name-only,
   * never a DB hit during a render.
   */
  label(schema: string | null, table: string | null, column: string): Label {
    if (schema && table) {
      const hit = this.map.get(key(schema, table, column));
      if (hit) return hit.label;
    }
    // Bare column reference (no qualifier) — scan all entries with this
    // column name. If multiple disagree, take the highest severity.
    const lc = column.toLowerCase();
    let bare: Label | null = null;
    for (const [k, v] of this.map) {
      if (k.endsWith('.' + lc)) {
        if (bare === null) bare = v.label;
        else bare = highestSeverity(bare, v.label);
      }
    }
    if (bare !== null) return bare;

    // No persisted classification at all — fall back to name regex.
    return classifyByName(column);
  }
}

function highestSeverity(a: Label, b: Label): Label {
  const rank: Record<Label, number> = { safe: 0, 'quasi-id': 1, pii: 2, secret: 3 };
  return (rank[a] ?? 0) >= (rank[b] ?? 0) ? a : b;
}

/**
 * Load every classification for a connector into an in-memory map. One
 * SQL round-trip per run. At 1k columns the map is < 100 KB.
 */
export async function loadClassificationsForConnector(
  connectorId: string,
): Promise<ClassificationMap> {
  const { rows } = await db().query<ColumnClassification>(
    `SELECT schema_name AS schema, table_name AS table, column_name AS column,
            label, source, sample_confidence
       FROM column_classifications
      WHERE connector_id = $1`,
    [connectorId],
  );
  return new ClassificationMap(rows);
}

// ---------------------------------------------------------------------------
// Crawl-time classification.
// ---------------------------------------------------------------------------

interface CrawlContext {
  /** A connected pg Client or PoolClient against the operator's DB. */
  client: PoolClient | Client;
  /** UUID of env_connectors row. */
  connectorId: string;
  /** UUID of the org this connector belongs to (denormalized for the
   *  org_id NOT NULL column on column_classifications). */
  orgId: string;
  /** Schemas to scan. Comes from `env_connectors.config.schema_allowlist`
   *  (CSV, default 'public'). */
  schemas: string[];
  /** Optional bound — useful for large DBs where the first crawl should
   *  be quick. The remaining tables get classified lazily on first use. */
  maxTables?: number;
}

export interface CrawlResult {
  tables_scanned: number;
  columns_classified: number;
  secrets_found: number;
  pii_found: number;
  errors: string[];
}

/**
 * Walk information_schema, classify every column. Idempotent — re-runs
 * overwrite `auto` rows; never touches `operator` rows.
 */
export async function crawlClassifyConnector(ctx: CrawlContext): Promise<CrawlResult> {
  const result: CrawlResult = {
    tables_scanned: 0,
    columns_classified: 0,
    secrets_found: 0,
    pii_found: 0,
    errors: [],
  };

  // Enumerate columns from information_schema.
  const placeholders = ctx.schemas.map((_, i) => `$${i + 1}`).join(',');
  const schemaList = ctx.schemas;
  const colsResult = await ctx.client.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
  }>(
    `SELECT table_schema, table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema IN (${placeholders})
      ORDER BY table_schema, table_name, ordinal_position`,
    schemaList,
  );

  // Group by table so we can sample efficiently per-table.
  const tables = new Map<string, { schema: string; table: string; columns: typeof colsResult.rows }>();
  for (const row of colsResult.rows) {
    const k = `${row.table_schema}.${row.table_name}`;
    if (!tables.has(k)) {
      tables.set(k, { schema: row.table_schema, table: row.table_name, columns: [] });
    }
    tables.get(k)!.columns.push(row);
  }

  const tableList = Array.from(tables.values());
  const capped = ctx.maxTables ? tableList.slice(0, ctx.maxTables) : tableList;
  result.tables_scanned = capped.length;

  for (const t of capped) {
    // First pass: classify every column by name. Anything secret/pii gets
    // confidence 1.0 immediately and we skip the sample for it. The value
    // pass only runs on columns that name-classify to `safe`.
    const toSample: string[] = [];
    const labels = new Map<string, { label: Label; confidence: number }>();
    for (const c of t.columns) {
      const nameLabel = classifyByName(c.column_name);
      if (nameLabel !== 'safe') {
        labels.set(c.column_name, { label: nameLabel, confidence: 1.0 });
        if (nameLabel === 'secret') result.secrets_found += 1;
        if (nameLabel === 'pii') result.pii_found += 1;
      } else {
        toSample.push(c.column_name);
      }
    }

    // Second pass: sample N rows from the table; for each `safe`-by-name
    // column, run value classification on the sampled cells. Promote the
    // column's label if any sample matches.
    if (toSample.length > 0) {
      const colList = toSample.map(quoteIdent).join(', ');
      const tableRef = `${quoteIdent(t.schema)}.${quoteIdent(t.table)}`;
      try {
        const sample = await Promise.race([
          ctx.client.query<Record<string, unknown>>(
            `SELECT ${colList} FROM ${tableRef} TABLESAMPLE SYSTEM(1) LIMIT ${CRAWL_SAMPLE_SIZE}`,
          ),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('sample_timeout')), CRAWL_PER_COLUMN_TIMEOUT_MS),
          ),
        ]);
        for (const col of toSample) {
          let matched = 0;
          let highest: Label = 'safe';
          for (const row of sample.rows) {
            const val = row[col];
            const lbl = classifyByValue(val);
            if (lbl !== 'safe') {
              matched += 1;
              highest = highestSeverity(highest, lbl);
            }
          }
          if (matched > 0) {
            const confidence = matched / sample.rows.length;
            labels.set(col, { label: highest, confidence });
            if (highest === 'secret') result.secrets_found += 1;
            if (highest === 'pii') result.pii_found += 1;
          } else {
            labels.set(col, { label: 'safe', confidence: 1.0 });
          }
        }
      } catch (err) {
        result.errors.push(`${t.schema}.${t.table}: ${(err as Error).message}`);
        // Skip value pass for this table — still upsert name-classified rows.
        for (const col of toSample) {
          if (!labels.has(col)) labels.set(col, { label: 'safe', confidence: 0.0 });
        }
      }
    }

    // Upsert into column_classifications. Operator-overridden rows are NOT
    // touched (source='operator' wins via WHERE).
    for (const c of t.columns) {
      const l = labels.get(c.column_name);
      if (!l) continue;
      await db().query(
        `INSERT INTO column_classifications
                  (org_id, connector_id, schema_name, table_name, column_name,
                   label, source, sample_confidence)
                  VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7)
              ON CONFLICT (connector_id, schema_name, table_name, column_name)
              DO UPDATE SET
                   label             = EXCLUDED.label,
                   sample_confidence = EXCLUDED.sample_confidence,
                   updated_at        = now()
                 WHERE column_classifications.source = 'auto'`,
        [ctx.orgId, ctx.connectorId, t.schema, t.table, c.column_name, l.label, l.confidence],
      );
      result.columns_classified += 1;
    }
  }

  return result;
}

/**
 * Safe identifier quoting for the in-DB sample query. Postgres identifiers
 * can be lowercased, mixed case (needs double-quoting), or contain spaces.
 * Doubles internal quotes per the spec.
 */
function quoteIdent(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"';
}
