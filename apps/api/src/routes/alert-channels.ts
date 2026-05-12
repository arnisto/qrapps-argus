import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SeveritySchema, NotFoundError, ValidationError, AppError } from '@argus/shared';
import { db } from '../db.js';

/**
 * Alert channels — full CRUD for routing findings to Slack / Discord /
 * generic webhooks.
 *
 * Channel `config` is JSONB. The shape is validated per-type via
 * discriminated union below; we explicitly do NOT store secrets in `config`.
 * Use `webhook_url_env` (slack/discord) or `secret_env` (webhook) to point at
 * an env var on the worker container.
 */
export async function registerAlertChannelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/alert-channels', async (req) => {
    const q = req.query as { include_disabled?: string };
    const where = q.include_disabled === 'true' ? '' : 'WHERE enabled = true';
    const result = await db().query(
      `SELECT id, type, name, enabled, config, created_at
       FROM alert_channels
       ${where}
       ORDER BY name ASC`,
    );
    return { alert_channels: result.rows };
  });

  app.get('/v1/alert-channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db().query('SELECT * FROM alert_channels WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { alert_channel: result.rows[0] };
  });

  app.post('/v1/alert-channels', async (req, reply) => {
    const parsed = ChannelCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid alert channel body', { issues: parsed.error.issues });
    }
    const body = parsed.data;
    const id = body.id ?? slugify(body.name);
    if (!/^[a-z][a-z0-9._-]*$/.test(id)) {
      throw new ValidationError(`derived id "${id}" is not a valid slug`);
    }
    const exists = await db().query('SELECT 1 FROM alert_channels WHERE id = $1', [id]);
    if ((exists.rowCount ?? 0) > 0) {
      throw new AppError({
        code: 'conflict',
        message: `alert channel "${id}" already exists`,
        status: 409,
      });
    }
    await db().query(
      `INSERT INTO alert_channels (id, type, name, config, enabled)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [id, body.type, body.name, JSON.stringify(body.config), body.enabled],
    );
    reply.code(201);
    return { channel_id: id };
  });

  app.put('/v1/alert-channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await db().query<{ type: string }>(
      'SELECT type FROM alert_channels WHERE id = $1',
      [id],
    );
    if (current.rowCount === 0) {
      throw new NotFoundError(`alert channel "${id}" not found`);
    }

    const parsed = ChannelUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('invalid alert channel body', { issues: parsed.error.issues });
    }
    const body = parsed.data;

    // type is immutable. If config is provided, validate against the existing type.
    if (body.config !== undefined) {
      const configSchema = configSchemaFor(current.rows[0]!.type);
      const validated = configSchema.safeParse(body.config);
      if (!validated.success) {
        throw new ValidationError('invalid config for channel type', {
          issues: validated.error.issues,
        });
      }
      body.config = validated.data as Record<string, unknown>;
    }

    const sets: string[] = [];
    const params: unknown[] = [id];
    if (body.name !== undefined) {
      params.push(body.name);
      sets.push(`name = $${params.length}`);
    }
    if (body.enabled !== undefined) {
      params.push(body.enabled);
      sets.push(`enabled = $${params.length}`);
    }
    if (body.config !== undefined) {
      params.push(JSON.stringify(body.config));
      sets.push(`config = $${params.length}::jsonb`);
    }
    if (sets.length === 0) {
      return { channel_id: id };
    }
    await db().query(`UPDATE alert_channels SET ${sets.join(', ')} WHERE id = $1`, params);
    reply.code(200);
    return { channel_id: id };
  });

  app.delete('/v1/alert-channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const exists = await db().query('SELECT 1 FROM alert_channels WHERE id = $1', [id]);
    if (exists.rowCount === 0) {
      throw new NotFoundError(`alert channel "${id}" not found`);
    }
    // CASCADE on alerts handles dispatched-alert rows.
    await db().query('DELETE FROM alert_channels WHERE id = $1', [id]);
    reply.code(204).send();
  });
}

// ---------------------------------------------------------------------------
// Per-type config schemas
// ---------------------------------------------------------------------------

const SlackConfigSchema = z.object({
  webhook_url: z.string().url().optional(),
  webhook_url_env: z.string().optional(),
  min_severity: SeveritySchema.optional(),
});

const DiscordConfigSchema = z.object({
  webhook_url: z.string().url().optional(),
  webhook_url_env: z.string().optional(),
  min_severity: SeveritySchema.optional(),
});

const WebhookConfigSchema = z.object({
  url: z.string().url(),
  secret_env: z.string().optional(),
  min_severity: SeveritySchema.optional(),
});

const ChannelCreateSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().regex(/^[a-z][a-z0-9._-]*$/).optional(),
    type: z.literal('slack'),
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    config: SlackConfigSchema,
  }),
  z.object({
    id: z.string().regex(/^[a-z][a-z0-9._-]*$/).optional(),
    type: z.literal('discord'),
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    config: DiscordConfigSchema,
  }),
  z.object({
    id: z.string().regex(/^[a-z][a-z0-9._-]*$/).optional(),
    type: z.literal('webhook'),
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    config: WebhookConfigSchema,
  }),
]);

const ChannelUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

function configSchemaFor(type: string) {
  switch (type) {
    case 'slack':
      return SlackConfigSchema;
    case 'discord':
      return DiscordConfigSchema;
    case 'webhook':
      return WebhookConfigSchema;
    default:
      throw new ValidationError(`unknown channel type "${type}"`);
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
