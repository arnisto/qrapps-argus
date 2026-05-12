import pg from 'pg';
import { ConnectorError, childLogger } from '@argus/shared';
import type { Event } from '@argus/events';
import type { Connector } from '../types.js';
import { PostgresConnectorConfigSchema, type PostgresConnectorConfig, type PostgresMapping } from './config.js';

/**
 * v0.1 Postgres connector — poll-based.
 *
 * Reads rows whose cursor column has advanced since the last seen value, maps
 * each row to an Event according to the mapping config, and returns them.
 * The runtime persists events + advances cursors atomically; this class is
 * deliberately stateless beyond the open `pg.Pool`.
 *
 * Refuses to start if the configured user has any write privileges (DML/DDL).
 */
export class PostgresConnector implements Connector<PostgresConnectorConfig> {
  readonly type = 'postgres' as const;
  readonly id: string;

  private pool: pg.Pool | null = null;
  private config: PostgresConnectorConfig | null = null;
  private readonly log = childLogger({ component: 'connector.postgres' });

  constructor(id: string) {
    this.id = id;
  }

  async init(rawConfig: unknown): Promise<void> {
    const config = PostgresConnectorConfigSchema.parse(rawConfig);
    this.config = config;

    this.pool = new pg.Pool({
      host: config.connection.host,
      port: config.connection.port,
      database: config.connection.database,
      user: config.connection.user,
      password: config.connection.password,
      ssl: config.connection.ssl ? { rejectUnauthorized: false } : false,
      max: 4,
      idleTimeoutMillis: 30_000,
    });

    await this.assertReadOnly();
    this.log.info({ connector_id: this.id }, 'postgres.connector.initialized');
  }

  async poll(): Promise<Event[]> {
    // Cursor coordination + event publishing happens in the worker that
    // calls this method. The connector itself doesn't know the cursor;
    // see workers/src/connectors/poll.ts for the orchestration.
    throw new Error('PostgresConnector.poll() must be invoked through the connector worker');
  }

  /**
   * Read a batch for one mapping past `sinceCursor`. Used by the worker.
   */
  async pollMapping(mapping: PostgresMapping, sinceCursor: string | null): Promise<{ events: Event[]; nextCursor: string | null }> {
    if (!this.pool || !this.config) throw new ConnectorError('connector not initialized');

    const fieldNames = Object.values(mapping.fields).filter((v) => v !== '*');
    const projectAll = Object.values(mapping.fields).includes('*');
    const selectCols = projectAll ? '*' : Array.from(new Set([mapping.cursor.column, ...fieldNames])).join(', ');
    const op = mapping.cursor.strategy === 'gt' ? '>' : '>=';
    const where = [
      sinceCursor ? `${ident(mapping.cursor.column)} ${op} $1` : null,
      mapping.when ? `(${mapping.when})` : null,
    ]
      .filter(Boolean)
      .join(' AND ');
    const sql =
      `SELECT ${selectCols} FROM ${ident(mapping.table)}` +
      (where ? ` WHERE ${where}` : '') +
      ` ORDER BY ${ident(mapping.cursor.column)} ASC LIMIT ${this.config.batch_size}`;

    const params = sinceCursor ? [sinceCursor] : [];
    const result = await this.pool.query(sql, params);

    let nextCursor: string | null = sinceCursor;
    const events: Event[] = result.rows.map((row) => {
      const cursorVal = String(row[mapping.cursor.column]);
      nextCursor = cursorVal;

      const payload = projectAll
        ? row
        : Object.fromEntries(
            Object.entries(mapping.fields)
              .filter(([, src]) => src !== '*')
              .map(([dest, src]) => [dest, row[src]]),
          );

      const occurredAt =
        mapping.fields['timestamp'] && row[mapping.fields['timestamp']]
          ? new Date(row[mapping.fields['timestamp']]).toISOString()
          : new Date().toISOString();

      const event: Event = {
        event_id: '', // filled by EventBus.publish
        event_type: mapping.event_type,
        schema_version: 1,
        source: { connector_id: this.id, connector_type: 'postgres', table: mapping.table },
        occurred_at: occurredAt,
        payload,
        ...(mapping.subject
          ? {
              subject: {
                type: mapping.subject.type,
                id: String(row[mapping.subject.id_field]),
              },
            }
          : {}),
      };
      return event;
    });

    return { events, nextCursor };
  }

  async stop(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Refuse to start if the configured role has any DML/DDL privileges on
   * any table. We will not be the cause of someone's prod outage.
   */
  private async assertReadOnly(): Promise<void> {
    if (!this.pool) return;
    const sql = `
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE grantee = current_user
        AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES')
      LIMIT 1
    `;
    const { rows } = await this.pool.query(sql);
    if (rows.length > 0) {
      throw new ConnectorError(
        `postgres connector "${this.id}" refused: configured user has write privileges. Use a read-only role.`,
      );
    }
  }
}

/** Conservative identifier quoting for table/column names from config. */
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new ConnectorError(`invalid identifier in connector config: ${name}`);
  }
  return `"${name}"`;
}
