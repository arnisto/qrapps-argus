import { z } from 'zod';

/**
 * Canonical Argus event. Connectors produce these; investigators consume them.
 * See docs/EVENTS.md for the full contract and naming convention.
 */
export const EventSchema = z.object({
  // No ':' — BullMQ uses it as its Redis key separator and rejects job IDs containing it.
  event_id: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_.\-]+$/, 'event_id must be alphanumeric + . _ - (no colons)'),
  event_type: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'event_type must be dotted lowercase'),
  schema_version: z.literal(1).default(1),

  source: z.object({
    connector_id: z.string().min(1),
    connector_type: z.enum(['postgres', 'mysql', 'api', 'webhook', 'manual']),
    table: z.string().optional(),
  }),

  occurred_at: z.string().datetime(),
  ingested_at: z.string().datetime().optional(),

  subject: z
    .object({
      type: z.string().min(1),
      id: z.string().min(1),
    })
    .optional(),

  payload: z.record(z.unknown()),
  tags: z.record(z.string()).optional(),
});

export type Event = z.infer<typeof EventSchema>;

/** Shape of `POST /v1/events` ingest body — `event_id` and `ingested_at` optional. */
export const IngestEventSchema = EventSchema.partial({
  event_id: true,
  ingested_at: true,
});
export type IngestEvent = z.infer<typeof IngestEventSchema>;
