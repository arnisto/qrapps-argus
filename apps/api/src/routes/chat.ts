/**
 * POST /v1/chat/completions  — OpenAI-compatible, RAG-augmented.
 *
 * Gate: Authorization: Bearer ak_live_…   (NOT the session cookie)
 *
 * Thin wrapper around `llm/chat.runGroundedChat` — the actual RAG flow is
 * shared with the dashboard's session-authed playground endpoint so both
 * doors return the exact same shape. This route is NOT under the
 * session-or-bearer gate in server.ts; it owns its own auth so the legacy
 * ARGUS_INGEST_TOKEN can't impersonate an env's API key.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyApiKey } from '../auth/api-key.js';
import { NoProviderError, runGroundedChat } from '../llm/chat.js';

const Body = z.object({
  model: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      }),
    )
    .min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(8192).optional(),
});

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/chat/completions', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    const key = await verifyApiKey(bearer);
    if (!key) return reply.code(401).send({ error: { message: 'invalid_api_key' } });

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: { message: 'bad_request', issues: parsed.error.issues } });
    }

    try {
      return await runGroundedChat(
        {
          envId: key.env_id,
          apiKeyId: key.key_id,
          messages: parsed.data.messages,
          model: parsed.data.model,
          temperature: parsed.data.temperature,
          max_tokens: parsed.data.max_tokens,
        },
        req.log,
      );
    } catch (err) {
      if (err instanceof NoProviderError) {
        return reply.code(412).send({
          error: {
            message: 'no_provider_configured',
            hint: 'Connect Gemini for this env first.',
          },
        });
      }
      return reply.code(502).send({ error: { message: (err as Error).message } });
    }
  });
}
