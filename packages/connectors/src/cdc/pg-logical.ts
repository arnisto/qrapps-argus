/**
 * Postgres logical replication detector.
 *
 * Phase 1 upgrade path: tenants who grant a REPLICATION role get
 * complete fidelity — every INSERT/UPDATE/DELETE, including deletes
 * the polling detector misses, in WAL order with ~1 s latency.
 *
 * One-time setup on the tenant's source DB:
 *
 *   CREATE PUBLICATION argus_pub FOR ALL TABLES;
 *   SELECT pg_create_logical_replication_slot('argus_slot', 'pgoutput');
 *
 * Then the tenant's Argus connector config flips strategy.kind from
 * 'poll_updated_at' to 'pg_logical_native'. No data is lost during
 * the switch as long as the slot exists before the polling cursor
 * advances past its position.
 *
 * Implementation note: this file is currently a STUB. It declares the
 * shape and yields nothing. The full implementation pulls in
 * `pg-logical-replication` (NodeJS lib) and the relevant package.json
 * dependency is added in this PR. The actual WAL parsing + event
 * emission lands in the follow-up KG Phase-1 PR.
 */

import type { ChangeDetector, ChangeEvent, CdcStrategy } from './types.js';

export interface PgLogicalDetectorOpts {
  tenant_id: string;
  connector_id: string;
  connection_string: string;        // tenant's source DB, with REPLICATION role
  strategy: Extract<CdcStrategy, { kind: 'pg_logical_native' }>;
}

export class PgLogicalDetector implements ChangeDetector {
  readonly strategy: CdcStrategy;
  private stopped = false;

  constructor(private readonly opts: PgLogicalDetectorOpts) {
    this.strategy = opts.strategy;
  }

  // eslint-disable-next-line require-yield -- stub: real impl yields ChangeEvents from WAL.
  async *start(): AsyncIterable<ChangeEvent> {
    // TODO(kg-phase-1): wire pg-logical-replication.
    //
    //   import { LogicalReplicationService, PgoutputPlugin } from 'pg-logical-replication';
    //
    //   const svc = new LogicalReplicationService({ connectionString: this.opts.connection_string });
    //   const plugin = new PgoutputPlugin({ protoVersion: 2, publicationNames: [this.opts.strategy.publication] });
    //   svc.on('data', (lsn, log) => { ...yield ChangeEvent... });
    //   await svc.subscribe(plugin, this.opts.strategy.slot);
    //
    // For now this detector is a placeholder so the strategy switch
    // compiles end-to-end. The runtime falls back to PollDetector when
    // any tenant selects pg_logical_native until this lands.
    if (this.stopped) return;
    throw new Error('pg_logical_native detector not yet implemented — use poll_updated_at');
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}
