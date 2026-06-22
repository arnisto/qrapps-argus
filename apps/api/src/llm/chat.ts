/**
 * RAG-grounded chat — extracted so both the public /v1/chat/completions
 * endpoint (bearer-authed, for buyers' code) and the dashboard's
 * /envs/:slug/ask endpoint (session-authed, for the Playground UI) can
 * share the exact same engine and response shape.
 *
 * Returns an OpenAI-shaped completion + `argus_citations[]` + optional
 * `argus_warning: "no_grounded_context"`. Inserts a `requests` row before
 * returning so usage / cost / latency are always logged.
 */
import { db } from '../db.js';
import { complete, type ChatResponse, type OpenAIMessage } from './gemini.js';
import { retrieve, type RetrievedChunk } from './retrieve.js';
import { loadProviderForEnv } from '../routes/providers.js';

export interface GroundedRequest {
  envId: string;
  apiKeyId: string | null; // null when the call is from the dashboard playground
  messages: OpenAIMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface GroundedResponse extends ChatResponse {
  argus_citations: Array<{
    index: number;
    chunk_id: string;
    source_id: string;
    source_title: string;
    source_kind: string;
    score: number;
  }>;
  argus_warning?: 'no_grounded_context';
}

/** Thrown when the env has no Gemini provider configured yet. */
export class NoProviderError extends Error {
  constructor() {
    super('no_provider_configured');
    this.name = 'NoProviderError';
  }
}

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
  apiKeyId: string | null,
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

export async function runGroundedChat(
  req: GroundedRequest,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<GroundedResponse> {
  const provider = await loadProviderForEnv(req.envId, 'gemini');
  if (!provider) throw new NoProviderError();
  const model = req.model ?? provider.default_model;

  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const query = lastUser?.content ?? '';

  let chunks: RetrievedChunk[] = [];
  try {
    chunks = await retrieve(req.envId, query, provider, 8);
  } catch (err) {
    log?.warn({ err }, 'retrieve_failed_continuing_without_context');
  }

  const augmented: OpenAIMessage[] = [
    { role: 'system', content: SYSTEM_TEMPLATE(buildContextBlock(chunks)) },
    ...req.messages,
  ];

  let resp: ChatResponse;
  try {
    resp = await complete(provider, model, augmented, {
      temperature: req.temperature ?? 0.3,
      max_tokens: req.max_tokens ?? 4096,
    });
  } catch (err) {
    await logRequest(req.envId, req.apiKeyId, null, chunks.length, 'error').catch(() => {});
    throw err;
  }

  await logRequest(
    req.envId,
    req.apiKeyId,
    resp,
    chunks.length,
    chunks.length === 0 ? 'no_grounded_context' : 'ok',
  ).catch((err) => log?.warn({ err }, 'request_log_insert_failed'));

  return {
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
}
