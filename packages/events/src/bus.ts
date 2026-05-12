import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import { logger } from '@argus/shared';
import type { Event } from './schema.js';
import { EventSchema } from './schema.js';
import { QUEUES } from './queues.js';

/**
 * The EventBus is the seam between connectors and the rest of the system.
 *
 * Connectors call `publish(events)`. The bus:
 *   1. validates each event with Zod
 *   2. fills in `event_id` and `ingested_at` if missing
 *   3. enqueues an `events:process` job per event
 *
 * Persistence (events table) is handled downstream in the worker that consumes
 * `events:process`. That worker dedupes by `event_id` via ON CONFLICT DO NOTHING.
 */
export class EventBus {
  private readonly queue: Queue<Event>;

  constructor(redisUrl: string) {
    this.queue = new Queue<Event>(QUEUES.eventsProcess, { connection: { url: redisUrl } });
  }

  async publish(events: Array<Partial<Event>>): Promise<void> {
    const now = new Date().toISOString();
    const ready: Event[] = events.map((raw) => {
      const parsed = EventSchema.parse({
        ...raw,
        event_id: raw.event_id ?? deterministicId(raw),
        ingested_at: raw.ingested_at ?? now,
      });
      return parsed;
    });

    if (ready.length === 0) return;

    await this.queue.addBulk(
      ready.map((event) => ({
        name: event.event_type,
        data: event,
        opts: {
          jobId: event.event_id, // BullMQ-level dedup
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      })),
    );

    logger.debug({ count: ready.length }, 'events.published');
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * Produce a deterministic event_id when the connector didn't supply one.
 * Stable across replays so duplicate inserts dedup naturally.
 */
function deterministicId(event: Partial<Event>): string {
  const tuple = [
    event.source?.connector_id ?? 'unknown',
    event.event_type ?? 'unknown',
    event.subject?.id ?? '',
    event.occurred_at ?? '',
  ].join('|');
  const hash = createHash('sha256').update(tuple).digest('hex').slice(0, 24);
  return `evt_${hash}`;
}
