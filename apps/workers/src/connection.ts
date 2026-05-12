import IORedis from 'ioredis';
import { loadConfig } from '@argus/shared';

let _conn: IORedis | null = null;

/** Shared ioredis connection for BullMQ. `maxRetriesPerRequest: null` is required by BullMQ. */
export function redis(): IORedis {
  if (_conn) return _conn;
  _conn = new IORedis(loadConfig().redisUrl, { maxRetriesPerRequest: null });
  return _conn;
}
