import pg from 'pg';
import { loadConfig } from '@argus/shared';

let _pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (_pool) return _pool;
  _pool = new pg.Pool({ connectionString: loadConfig().databaseUrl, max: 10 });
  return _pool;
}
