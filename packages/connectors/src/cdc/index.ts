/**
 * Change Data Capture (CDC) module — public entrypoint.
 *
 * The factory dispatches on strategy.kind. Adding a new strategy:
 *   1. Add a variant to `CdcStrategy` in ./types
 *   2. Add a detector implementation
 *   3. Add a branch to `createDetector` below
 *
 * The runtime never imports a specific detector — only this factory.
 */

export type { CdcStrategy, CdcStrategyKind, ChangeDetector, ChangeEvent } from './types.js';
export { PollDetector } from './poll.js';
export { PgLogicalDetector } from './pg-logical.js';

import type { Pool } from 'pg';
import type { CdcStrategy, ChangeDetector } from './types.js';
import type { ConnectorCursorStore } from '../types.js';
import { PollDetector } from './poll.js';
import { PgLogicalDetector } from './pg-logical.js';

export interface CreateDetectorOpts {
  tenant_id: string;
  connector_id: string;
  pool: Pool;
  table: string;
  pk_cols: string[];
  cursorStore: ConnectorCursorStore;
  connection_string: string;
}

export function createDetector(strategy: CdcStrategy, opts: CreateDetectorOpts): ChangeDetector {
  switch (strategy.kind) {
    case 'poll_updated_at':
    case 'poll_id_only':
      return new PollDetector({
        tenant_id: opts.tenant_id,
        connector_id: opts.connector_id,
        pool: opts.pool,
        table: opts.table,
        pk_cols: opts.pk_cols,
        cursorStore: opts.cursorStore,
        strategy,
      });
    case 'pg_logical_native':
      return new PgLogicalDetector({
        tenant_id: opts.tenant_id,
        connector_id: opts.connector_id,
        connection_string: opts.connection_string,
        strategy,
      });
    case 'snapshot_diff':
    case 'debezium_server':
      throw new Error(`CDC strategy '${strategy.kind}' not yet implemented`);
  }
}
