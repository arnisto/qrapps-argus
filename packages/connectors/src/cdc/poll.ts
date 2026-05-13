/**
 * Polling-based change detector.
 *
 * The default strategy: queries the source table for rows whose cursor
 * column has advanced since the last seen value. Works on any database;
 * requires no special privileges on the source.
 *
 * Caveats every tenant must accept before relying on this:
 *   - Misses DELETEs entirely. Pair with snapshot_diff if deletes matter.
 *   - Misses UPDATEs whose cursor column doesn't bump.
 *   - Tables without updated_at fall back to poll_id_only (insert-only).
 *
 * Cursor persistence is delegated to the existing ConnectorCursorStore;
 * this detector just reads/writes through it.
 */

import type { Pool } from 'pg';
import type { ChangeDetector, ChangeEvent, CdcStrategy } from './types.js';
import type { ConnectorCursorStore } from '../types.js';

export interface PollDetectorOpts {
  tenant_id: string;
  connector_id: string;
  pool: Pool;
  table: string;
  pk_cols: string[];
  cursorStore: ConnectorCursorStore;
  strategy: Extract<CdcStrategy, { kind: 'poll_updated_at' | 'poll_id_only' }>;
}

export class PollDetector implements ChangeDetector {
  readonly strategy: CdcStrategy;
  private stopped = false;

  constructor(private readonly opts: PollDetectorOpts) {
    this.strategy = opts.strategy;
  }

  async *start(): AsyncIterable<ChangeEvent> {
    const { tenant_id, connector_id, pool, table, pk_cols, cursorStore, strategy } = this.opts;
    const cursorCol = strategy.cursor_col;
    const intervalMs = strategy.interval_ms;
    const mappingKey = `cdc:${table}:${cursorCol}`;

    while (!this.stopped) {
      const lastCursor = await cursorStore.get(connector_id, mappingKey);

      // Read-only, bounded query. The customer's source DB must have a
      // role that can SELECT but cannot mutate — enforced at the
      // connection layer, not here.
      const sql = lastCursor
        ? `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(cursorCol)} > $1 ORDER BY ${quoteIdent(cursorCol)} LIMIT 10000`
        : `SELECT * FROM ${quoteIdent(table)} ORDER BY ${quoteIdent(cursorCol)} LIMIT 10000`;

      const { rows } = await pool.query(sql, lastCursor ? [lastCursor] : []);

      let advanced: string | null = null;
      for (const row of rows) {
        const pk: Record<string, unknown> = {};
        for (const col of pk_cols) pk[col] = row[col];
        const cursorValue = String(row[cursorCol]);
        if (!advanced || cursorValue > advanced) advanced = cursorValue;

        // Polling cannot distinguish insert from update without extra
        // bookkeeping; treat as 'update' if cursor advanced past last
        // seen, else 'insert'. The drip enricher is idempotent either
        // way, so the distinction matters only for logging.
        yield {
          tenant_id,
          connector_id,
          table,
          op: lastCursor ? 'update' : 'insert',
          pk,
          row,
          detected_at: new Date().toISOString(),
        };
      }

      if (advanced) {
        await cursorStore.set(connector_id, mappingKey, advanced);
      }

      if (this.stopped) break;
      await sleep(intervalMs);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

function quoteIdent(name: string): string {
  // Naive but safe enough for table/column names that pass schema crawl.
  return `"${name.replace(/"/g, '""')}"`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
