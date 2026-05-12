import pg from 'pg';
import { loadConfig } from '@argus/shared';

let _pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (_pool) return _pool;
  const config = loadConfig();
  _pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
