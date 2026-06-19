/**
 * Versioned migration runner.
 *
 * Applies every .sql file under docker/postgres/migrations/ in lexical order
 * (the NNNN_ prefix gives natural numeric ordering), inside its own
 * transaction, and records the applied filename in `_migrations` so the next
 * run only applies what's new.
 *
 * The base schema (docker/postgres/init.sql) is still loaded by Compose on
 * fresh volumes; it remains the canonical "v0.1 observability core". This
 * runner is for everything added after it — including the v0.3
 * knowledge-layer + auth (migration 0007).
 *
 * Usage: `pnpm db:migrate` (resolves DATABASE_URL via packages/shared/config).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logger, loadConfig } from '@argus/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'docker',
  'postgres',
  'migrations',
);

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename     TEXT        PRIMARY KEY,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function applied(client: pg.Client): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>(
    `SELECT filename FROM _migrations`,
  );
  return new Set(rows.map((r) => r.filename));
}

function discover(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await ensureMigrationsTable(client);
    const already = await applied(client);
    const files = discover();
    const pending = files.filter((f) => !already.has(f));

    if (pending.length === 0) {
      logger.info({ total: files.length }, 'db.migrate.up_to_date');
      return;
    }

    logger.info({ pending }, 'db.migrate.starting');

    for (const file of pending) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO _migrations (filename) VALUES ($1)`,
          [file],
        );
        await client.query('COMMIT');
        logger.info({ file }, 'db.migrate.applied');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err, file }, 'db.migrate.failed');
        throw err;
      }
    }

    logger.info({ applied: pending.length }, 'db.migrate.done');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'db.migrate.failed');
  process.exit(1);
});
