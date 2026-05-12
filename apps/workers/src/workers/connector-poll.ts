import { childLogger, ConnectorError, loadConfig } from '@argus/shared';
import { EventBus } from '@argus/events';
import {
  createConnector,
  PostgresConnector,
  PostgresConnectorConfigSchema,
} from '@argus/connectors';
import { db } from '../db.js';

/**
 * Repeating poller for v0.1.
 *
 * Loops every `POLL_TICK_MS` and, for each enabled connector, walks its
 * mappings, advances cursors in the same transaction as `events` inserts via
 * the bus + the events:process worker.
 *
 * Lightweight on purpose: replaced by BullMQ-repeatable jobs in v0.2 once we
 * have multiple worker replicas needing coordination.
 */
const POLL_TICK_MS = 30_000;

export async function startConnectorPoller(): Promise<() => Promise<void>> {
  const log = childLogger({ component: 'workers.connector-poll' });
  const bus = new EventBus(loadConfig().redisUrl);
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const rows = await db().query<{ id: string; type: string; config: unknown }>(
        `SELECT id, type, config FROM connectors WHERE enabled = true`,
      );

      for (const row of rows.rows) {
        if (row.type !== 'postgres') continue; // v0.1 only postgres

        const connector = createConnector('postgres', row.id) as PostgresConnector;
        try {
          await connector.init(row.config);
          const config = PostgresConnectorConfigSchema.parse(row.config);

          for (const mapping of config.mappings) {
            const cursorRow = await db().query<{ cursor_value: string | null }>(
              `SELECT cursor_value FROM connector_cursors WHERE connector_id = $1 AND mapping_key = $2`,
              [row.id, mapping.table],
            );
            const since = cursorRow.rows[0]?.cursor_value ?? null;

            const { events, nextCursor } = await connector.pollMapping(mapping, since);
            if (events.length === 0) continue;

            await bus.publish(events);
            if (nextCursor && nextCursor !== since) {
              await db().query(
                `INSERT INTO connector_cursors (connector_id, mapping_key, cursor_value)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (connector_id, mapping_key)
                 DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()`,
                [row.id, mapping.table, nextCursor],
              );
            }
            log.debug({ connector_id: row.id, mapping: mapping.table, count: events.length }, 'connector.poll.batch');
          }

          await db().query(
            `UPDATE connectors SET last_sync_at = now(), last_error = NULL WHERE id = $1`,
            [row.id],
          );
        } catch (err) {
          const message = err instanceof ConnectorError ? err.message : (err as Error).message;
          await db().query(`UPDATE connectors SET last_error = $2 WHERE id = $1`, [row.id, message]);
          log.error({ err, connector_id: row.id }, 'connector.poll.failed');
        } finally {
          await connector.stop().catch(() => undefined);
        }
      }
    } catch (err) {
      log.error({ err }, 'connector.poll.tick_failed');
    }
  };

  const interval = setInterval(tick, POLL_TICK_MS);
  // run an initial tick on boot so users don't wait for the first interval.
  setTimeout(tick, 1_000);

  return async () => {
    stopped = true;
    clearInterval(interval);
    await bus.close();
  };
}
