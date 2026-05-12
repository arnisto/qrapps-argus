/**
 * Drop every Argus table, re-run init, re-seed builtin investigators.
 * DESTRUCTIVE — only for local dev. Refuses to run when NODE_ENV=production.
 */
import pg from 'pg';
import { logger, loadConfig } from '@argus/shared';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.nodeEnv === 'production') {
    throw new Error('db:reset refuses to run with NODE_ENV=production');
  }

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    // Drop order respects FK direction: dependents first, parents last.
    await client.query(`
      DROP TABLE IF EXISTS agent_runs CASCADE;
      DROP TABLE IF EXISTS pipeline_agents CASCADE;
      DROP TABLE IF EXISTS agents CASCADE;
      DROP TABLE IF EXISTS alerts CASCADE;
      DROP TABLE IF EXISTS alert_channels CASCADE;
      DROP TABLE IF EXISTS findings CASCADE;
      DROP TABLE IF EXISTS investigations CASCADE;
      DROP TABLE IF EXISTS investigators CASCADE;
      DROP TABLE IF EXISTS connector_cursors CASCADE;
      DROP TABLE IF EXISTS connectors CASCADE;
      DROP TABLE IF EXISTS events CASCADE;
    `);
    logger.warn('db.reset.dropped');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'db.reset.failed');
  process.exit(1);
});
