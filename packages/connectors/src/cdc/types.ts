/**
 * Change Data Capture (CDC) strategy interface.
 *
 * Detecting modifications on a customer's source database has no single
 * right answer — it depends on what access the customer grants and how
 * much freshness the playbook needs. This file defines the strategy
 * contract every detector implements; the connector picks one at
 * runtime per-tenant from its config.
 *
 * Why a strategy interface and not just "use logical replication":
 * many tenants will never grant a REPLICATION role on their DB. We have
 * to ship a working default (polling) and let those who can upgrade.
 *
 * Strategies — ordered by fidelity:
 *
 *   1. poll_updated_at          (default; works on any DB with an updated_at)
 *   2. poll_id_only             (insert-only tables, e.g. event logs)
 *   3. pg_logical_native        (Postgres only; consumes WAL via pg-logical-replication)
 *   4. snapshot_diff            (nightly fallback; catches DELETEs polling misses)
 *   5. debezium_server          (Phase 2; multi-DB via Debezium Server sink → Redis)
 *
 * What lives downstream: every ChangeEvent emitted here is enqueued onto
 * the BullMQ `kg.drip` queue and consumed by the Knowledge Graph drip
 * enricher (see docs/KNOWLEDGE_GRAPH.md §Phase 1).
 */

export type CdcStrategyKind =
  | 'poll_updated_at'
  | 'poll_id_only'
  | 'pg_logical_native'
  | 'snapshot_diff'
  | 'debezium_server';

export type CdcStrategy =
  | { kind: 'poll_updated_at'; cursor_col: string; interval_ms: number }
  | { kind: 'poll_id_only';    cursor_col: string; interval_ms: number }
  | { kind: 'pg_logical_native'; slot: string; publication: string }
  | { kind: 'snapshot_diff';   cron: string }
  | { kind: 'debezium_server'; sink: 'redis' | 'nats'; endpoint: string };

/**
 * A single detected change. `op` aligns with WAL operations: insert |
 * update | delete. Polling detectors emit `insert` for new rows and
 * `update` for advanced cursor matches; they cannot emit `delete`
 * without help from snapshot_diff.
 */
export interface ChangeEvent {
  tenant_id: string;
  connector_id: string;
  table: string;
  op: 'insert' | 'update' | 'delete';
  pk: Record<string, unknown>;       // primary key columns of the changed row
  row?: Record<string, unknown>;     // full row for insert/update; omitted for delete
  lsn?: string;                      // Postgres LSN for pg_logical_native; otherwise undefined
  detected_at: string;               // ISO timestamp
}

/**
 * A detector runs continuously and yields change events. The runtime
 * is responsible for back-pressure (BullMQ provides it for free) and
 * for persisting cursors (existing connector_cursors table).
 */
export interface ChangeDetector {
  readonly strategy: CdcStrategy;
  start(): AsyncIterable<ChangeEvent>;
  stop(): Promise<void>;
}
