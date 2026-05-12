import type { Connector, ConnectorType } from './types.js';
import { PostgresConnector } from './postgres/index.js';

type ConnectorFactory = (id: string) => Connector;

/**
 * Registry of available connector implementations. v0.1 ships only Postgres;
 * MySQL/API/Webhook entries are reserved for v0.2 and intentionally throw
 * a clear "not yet implemented" error rather than 500-ing silently.
 */
const REGISTRY: Record<ConnectorType, ConnectorFactory> = {
  postgres: (id) => new PostgresConnector(id),
  mysql: () => {
    throw new Error('mysql connector lands in v0.2');
  },
  api: () => {
    throw new Error('api connector lands in v0.2');
  },
  webhook: () => {
    throw new Error('webhook connector lands in v0.2');
  },
};

export function createConnector(type: ConnectorType, id: string): Connector {
  const factory = REGISTRY[type];
  if (!factory) throw new Error(`unknown connector type: ${type}`);
  return factory(id);
}
