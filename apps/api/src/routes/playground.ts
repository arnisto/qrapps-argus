/**
 * POST /envs/:slug/ask  — dashboard Playground endpoint.
 *
 * Same engine as /v1/chat/completions, but authed by the user session +
 * org-membership check instead of an API key. Lets the dashboard call
 * grounded chat without exposing an API key to the browser.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/middleware.js';
import { NoProviderError, runGroundedChat } from '../llm/chat.js';
import { resolveEnv } from './env-scope.js';

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      }),
    )
    .min(1),
  model: z.string().optional(),
});

export async function registerPlaygroundRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { slug: string } }>(
    '/envs/:slug/ask',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const env = await resolveEnv(req, reply, req.params.slug, false);
      if (!env) return;
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', issues: parsed.error.issues });
      }
      try {
        return await runGroundedChat(
          {
            envId: env.id,
            apiKeyId: null,
            messages: parsed.data.messages,
            model: parsed.data.model,
          },
          req.log,
        );
      } catch (err) {
        if (err instanceof NoProviderError) {
          return reply.code(412).send({
            error: 'no_provider_configured',
            message: 'Connect Gemini for this env first.',
          });
        }
        return reply.code(502).send({ error: 'provider_error', message: (err as Error).message });
      }
    },
  );
}
