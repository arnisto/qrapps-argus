import { Queue, Worker } from 'bullmq';
import { logger } from '@argus/shared';
import { QUEUES, type Event } from '@argus/events';
import { redis } from '../connection.js';
import { db } from '../db.js';

/**
 * Persist a new event to Postgres and fan-out investigator runs for every
 * investigator subscribed to its event_type.
 *
 * Idempotent: persistence uses ON CONFLICT DO NOTHING on event_id, and the
 * fan-out runs even on conflict (BullMQ jobId on the run job dedups).
 */
export async function startEventsProcessWorker(): Promise<() => Promise<void>> {
  const runQueue = new Queue(QUEUES.investigatorsRun, { connection: redis() });

  const worker = new Worker<Event>(
    QUEUES.eventsProcess,
    async (job) => {
      const event = job.data;

      await db().query(
        `INSERT INTO events
           (event_id, event_type, schema_version, source, occurred_at, ingested_at, subject_type, subject_id, payload, tags)
         VALUES ($1, $2, $3, $4::jsonb, $5, COALESCE($6::timestamptz, now()), $7, $8, $9::jsonb, $10::jsonb)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          event.event_id,
          event.event_type,
          event.schema_version,
          JSON.stringify(event.source),
          event.occurred_at,
          event.ingested_at ?? null,
          event.subject?.type ?? null,
          event.subject?.id ?? null,
          JSON.stringify(event.payload),
          event.tags ? JSON.stringify(event.tags) : null,
        ],
      );

      const subscribers = await db().query<{ id: string }>(
        `SELECT id FROM investigators
         WHERE enabled = true
           AND definition -> 'triggers' -> 'events' ? $1`,
        [event.event_type],
      );

      for (const sub of subscribers.rows) {
        await runQueue.add(
          'run',
          { investigator_id: sub.id, trigger: { kind: 'event', event_id: event.event_id } },
          // BullMQ rejects ':' in job IDs (it's the Redis key separator). Use '.'.
          { jobId: `${sub.id}.${event.event_id}`, removeOnComplete: 500, removeOnFail: 1000 },
        );
      }

      logger.debug(
        { event_id: event.event_id, subscribers: subscribers.rowCount },
        'events.processed',
      );
    },
    { connection: redis(), concurrency: 8 },
  );

  worker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'events.process.failed'));

  return async () => {
    await worker.close();
    await runQueue.close();
  };
}
