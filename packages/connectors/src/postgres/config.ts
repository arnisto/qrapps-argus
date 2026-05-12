import { z } from 'zod';

export const PostgresMappingSchema = z.object({
  table: z.string().min(1),
  event_type: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'event_type must be dotted lowercase'),
  when: z.string().optional(),
  fields: z.record(z.string()),
  cursor: z.object({
    column: z.string().min(1),
    strategy: z.enum(['gt', 'gte']).default('gt'),
  }),
  subject: z
    .object({
      type: z.string().min(1),
      id_field: z.string().min(1),
    })
    .optional(),
});

export const PostgresConnectorConfigSchema = z.object({
  connection: z.object({
    host: z.string().min(1),
    port: z.coerce.number().int().positive().default(5432),
    database: z.string().min(1),
    user: z.string().min(1),
    password: z.string().min(1),
    ssl: z.boolean().default(false),
  }),
  mappings: z.array(PostgresMappingSchema).min(1),
  poll_interval_ms: z.coerce.number().int().positive().default(30_000),
  batch_size: z.coerce.number().int().positive().max(10_000).default(1_000),
});

export type PostgresMapping = z.infer<typeof PostgresMappingSchema>;
export type PostgresConnectorConfig = z.infer<typeof PostgresConnectorConfigSchema>;
