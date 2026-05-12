import type { Event } from '@argus/events';

export type ConnectorType = 'postgres' | 'mysql' | 'api' | 'webhook';

/**
 * The Connector contract. Every data source plugs in here.
 *
 * Connectors only produce events. They never call investigators, write
 * findings, or dispatch alerts — those concerns live downstream.
 */
export interface Connector<TConfig = unknown> {
  readonly id: string;
  readonly type: ConnectorType;

  init(config: TConfig): Promise<void>;

  /** For poll-based sources. Returns events since the last cursor advance. */
  poll?(): Promise<Event[]>;

  /** For push-based sources (webhooks). */
  ingest?(payload: unknown): Promise<Event[]>;

  stop(): Promise<void>;
}

/** Persisted cursor state, keyed by (connector_id, mapping_key). */
export interface ConnectorCursorStore {
  get(connectorId: string, mappingKey: string): Promise<string | null>;
  set(connectorId: string, mappingKey: string, value: string): Promise<void>;
}
