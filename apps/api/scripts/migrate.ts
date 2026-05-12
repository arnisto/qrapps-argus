/**
 * Run the bundled Postgres init script against DATABASE_URL.
 *
 * For v0.1 we keep one idempotent SQL file under docker/postgres/init.sql.
 * Compose runs it on first boot of the postgres volume; this script lets
 * users re-run it on demand or apply it to an external database.
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
    resolve(__dirname, '..', '..', '..', 'docker', 'postgres', 'init.sql'),
    'utf8',
  );
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
    logger.info('db.migrate.ok');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'db.migrate.failed');
  process.exit(1);
});
