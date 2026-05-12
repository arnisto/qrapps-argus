/**
 * Print depth + counts for every Argus BullMQ queue.
 *
 *   pnpm queues:inspect
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { logger, loadConfig } from '@argus/shared';
import { QUEUES } from '@argus/events';

async function main(): Promise<void> {
  const conn = new IORedis(loadConfig().redisUrl, { maxRetriesPerRequest: null });

  for (const name of Object.values(QUEUES)) {
    const q = new Queue(name, { connection: conn });
    const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    logger.info({ queue: name, ...counts }, 'queue.status');
    await q.close();
  }
  await conn.quit();
}

main().catch((err) => {
  logger.error({ err }, 'queues.inspect.failed');
  process.exit(1);
});
