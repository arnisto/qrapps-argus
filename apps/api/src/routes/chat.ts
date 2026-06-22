/**
 * POST /v1/chat/completions  — OpenAI-compatible, RAG-augmented.
 *
 * Gate:    Authorization: Bearer ak_live_…    (NOT the session cookie)
 * Flow:
 *   1. Verify the bearer against `api_keys` → env_id
 *   2. Embed the latest user turn, retrieve top-k chunks via pgvector
 *   3. Build a grounding system message ("CONTEXT: [#1] … [#2] …")
 *   4. Call the env's Gemini provider with the augmented messages
 *   5. Insert a row into `requests` (tokens / cost / latency / status)
 *   6. Return the OpenAI shape + `argus_citations[]`
 *
 * This route is NOT under the session-or-bearer gate in server.ts —
 * it owns its own auth so the legacy ARGUS_INGEST_TOKEN can't impersonate
 * an env's API key.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { verifyApiKey } from '../auth/api-key.js';
import { complete, type ChatResponse, type OpenAIMessage } from '../llm/gemini.js';
import { retrieve, type RetrievedChunk } from '../llm/retrieve.js';
import { loadProviderForEnv } from './providers.js';

const Body = z.object({
  model: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    }),
  ).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(8192).optional(),
});

const SYSTEM_TEMPLATE = (ctx: string) =>
  `You are an assistant answering on behalf of the company. Use ONLY the facts in CONTEXT to answer. If the context does not contain the answer, say plainly that you don't have that information yet — do not invent.

When you use a fact, you may reference it inline with [#1], [#2], etc., matching the CONTEXT numbering.

CONTEXT (most relevant first):
${ctx}
`;

function buildContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '(no relevant company facts found)';
  return chunks
    .map(
      (c, i) =>
        `[#${i + 1}] ${c.source_title} (${c.source_kind}, score=${c.score})\n${c.content}`,
    )
    .join('\n\n---\n\n');
}

async function logRequest(
  envId: string,
  apiKeyId: string,
  resp: ChatResponse | null,
  retrieved: number,
  status: string,
): Promise<void> {
  const provider = resp?._argus?.provider ?? 'gemini';
  const model = resp?._argus?.model ?? '';
  const usage = resp?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const latency = resp?._argus?.latency_ms ?? 0;
  const cost = resp?._argus?.cost_usd_estimate ?? 0;
  await db().query(
    `INSERT INTO requests (env_id, api_key_id, provider, model,
                            prompt_tokens, completion_tokens, total_tokens,
                            latency_ms, cost_usd, status, retrieved_chunks)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      envId,
      apiKeyId,
      provider,
      model,
      usage.prompt_tokens,
      usage.completion_tokens,
      usage.total_tokens,
      latency,
      cost,
      status,
      retrieved,
    ],
  );
}

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/chat/completions', async (req, reply) => {
    // ---- auth (bearer only, not session) ------------------------------------
    const auth = req.headers.authorization ?? '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    const key = await verifyApiKey(bearer);
    if (!key) return reply.code(401).send({ error: { message: 'invalid_api_key' } });

    // ---- body ----------------------------------------------------------------
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'bad_request', issues: parsed.error.issues } });
    }
    const { messages, model: requestedModel, temperature, max_tokens } = parsed.data;

    // ---- resolve provider for this env --------------------------------------
    const provider = await loadProviderForEnv(key.env_id, 'gemini');
    if (!provider) {
      return reply.code(412).send({
        error: { message: 'no_provider_configured', hint: 'Connect Gemini for this env first.' },
      });
    }
    const model = requestedModel ?? provider.default_model;

    // ---- retrieve grounded context against the latest user turn -------------
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const query = lastUser?.content ?? '';
    let chunks: RetrievedChunk[] = [];
    try {
      chunks = await retrieve(key.env_id, query, provider, 8);
    } catch (err) {
      req.log.warn({ err }, 'retrieve_failed_continuing_without_context');
    }

    // ---- call the model -----------------------------------------------------
    const sysBlock = SYSTEM_TEMPLATE(buildContextBlock(chunks));
    const augmented: OpenAIMessage[] = [
      { role: 'system', content: sysBlock },
      ...messages,
    ];

    let resp: ChatResponse;
    try {
      resp = await complete(provider, model, augmented, {
        temperature: temperature ?? 0.3,
        max_tokens: max_tokens ?? 4096,
      });
    } catch (err) {
      await logRequest(key.env_id, key.key_id, null, chunks.length, 'error').catch(() => {});
      return reply.code(502).send({ error: { message: (err as Error).message } });
    }

    // ---- enrich response ----------------------------------------------------
    const enriched = {
      ...resp,
      argus_citations: chunks.map((c, i) => ({
        index: i + 1,
        chunk_id: c.chunk_id,
        source_id: c.source_id,
        source_title: c.source_title,
        source_kind: c.source_kind,
        score: c.score,
      })),
      ...(chunks.length === 0 ? { argus_warning: 'no_grounded_context' as const } : {}),
    };

    await logRequest(
      key.env_id,
      key.key_id,
      resp,
      chunks.length,
      chunks.length === 0 ? 'no_grounded_context' : 'ok',
    ).catch((err) => req.log.warn({ err }, 'request_log_insert_failed'));

    return enriched;
  });
}
