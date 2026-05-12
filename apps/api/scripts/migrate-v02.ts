/**
 * Apply the v0.2 multi-agent schema migration to an existing install.
 *
 * On first boot, Postgres runs `docker/postgres/init.sql` which already
 * includes the v0.2 DDL — so fresh installs don't need this script. It exists
 * for upgrading a v0.1 deployment in place. Idempotent (every CREATE / ALTER
 * uses IF NOT EXISTS), so re-running is a no-op.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logger, loadConfig } from '@argus/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const config = loadConfig();
  const sql = readFileSync(
    resolve(__dirname, '..', '..', '..', 'docker', 'postgres', 'migrations', '0002_agents.sql'),
    'utf8',
  );
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    logger.info('db.migrate.v02.ok');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'db.migrate.v02.failed');
  process.exit(1);
});
