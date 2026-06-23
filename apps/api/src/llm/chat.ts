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
import { type ChatResponse, type OpenAIMessage } from './gemini.js';
import { retrieve, type RetrievedChunk } from './retrieve.js';
import { chatComplete, providerForModel } from './router.js';
import { loadProviderForEnv } from '../routes/providers.js';
import { planSql, type SqlPlan } from '../agent/sql-planner.js';
import { runQueryViaConnector, type DbQueryResult } from '../agent/db-query.js';

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
  /** Tool calls Argus made during this response (today: db.query only). */
  argus_tool_trace?: Array<{
    tool: 'db.query';
    connector_id: string;
    input: string;
    ok: boolean;
    rows_returned?: number;
    truncated?: boolean;
    latency_ms?: number;
    error?: string;
    reason?: string;
  }>;
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

/**
 * Each db_schema chunk's source.uri is `connector://<id>`. Among the
 * chunks the model is grounding on, pick the connector that contributed
 * the most — that's the one whose live data we should query.
 */
async function pickConnectorForChunks(chunks: RetrievedChunk[]): Promise<string | null> {
  if (chunks.length === 0) return null;
  const sourceIds = chunks.map((c) => c.source_id);
  const { rows } = await db().query<{ uri: string }>(
    `SELECT uri FROM sources WHERE id = ANY($1::uuid[])`,
    [sourceIds],
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    const m = /^connector:\/\/([0-9a-f-]+)$/.exec(r.uri ?? '');
    if (!m) continue;
    counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  }
  let winner: string | null = null;
  let max = 0;
  for (const [id, n] of counts) {
    if (n > max) {
      max = n;
      winner = id;
    }
  }
  return winner;
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
  // Embeddings ALWAYS go through Gemini — schema is vector(768) and only
  // gemini-embedding-001 with outputDimensionality=768 fits. Without Gemini
  // configured we can't even retrieve, so 412 either way.
  const geminiForEmbed = await loadProviderForEnv(req.envId, 'gemini');
  if (!geminiForEmbed) throw new NoProviderError();

  // Chat provider is picked by model name: llama* / mixtral* / groq/* → Groq,
  // gemini* → Gemini. Default model comes from the chosen chat provider's
  // configured default_model so the env's preferred model wins.
  const explicitModel = req.model && req.model.trim() ? req.model.trim() : null;
  const chatProviderName = providerForModel(explicitModel ?? geminiForEmbed.default_model);
  const chatProvider =
    chatProviderName === 'gemini'
      ? geminiForEmbed
      : await loadProviderForEnv(req.envId, chatProviderName);
  if (!chatProvider) {
    throw new NoProviderError();
  }
  const model = explicitModel ?? chatProvider.default_model;

  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const query = lastUser?.content ?? '';

  let chunks: RetrievedChunk[] = [];
  try {
    chunks = await retrieve(req.envId, query, geminiForEmbed, 8);
  } catch (err) {
    log?.warn({ err }, 'retrieve_failed_continuing_without_context');
  }

  // Relevance gate: retrieval ALWAYS returns top-k, even if the best chunk
  // is unrelated. Without this, the model would dutifully cite an irrelevant
  // chunk while saying "I don't know" — confusing the buyer and breaking
  // the no_grounded_context warning that powers the inline teach CTA on the
  // dashboard. Drop the chunks from the prompt entirely if the best
  // similarity is below the threshold; we still LOG them so we can tune later.
  // Calibrated against gemini-embedding-001 on warm-paper company docs:
  // genuinely related queries land 0.65+; tangential 0.55–0.65; unrelated
  // <0.55. 0.6 is the sweet spot — biases toward honest "I don't know" +
  // surfacing the teach CTA over confident-but-irrelevant citations.
  const SIM_THRESHOLD = 0.6;
  const usableChunks = chunks.filter((c) => c.sim >= SIM_THRESHOLD);

  // Agentic step: if any usable chunk came from a db_schema source, ask
  // the planner whether a SELECT would help. If yes, run it READ-ONLY,
  // inject the result rows into the grounding context. Output is logged
  // in argus_tool_trace so the dashboard can show what SQL Argus ran.
  const toolTrace: NonNullable<GroundedResponse['argus_tool_trace']> = [];
  let queryResultBlock = '';
  const dbChunks = usableChunks.filter((c) => c.source_kind === 'db_schema');
  if (dbChunks.length > 0) {
    // Pick the connector that contributed the most retrieved chunks.
    const connectorId = await pickConnectorForChunks(dbChunks);
    if (connectorId) {
      let plan: SqlPlan;
      try {
        plan = await planSql(geminiForEmbed, model, query, dbChunks);
      } catch (err) {
        log?.warn({ err }, 'planner_failed');
        plan = { sql: null, reason: 'planner_threw' };
      }
      if (plan.sql) {
        let result: DbQueryResult;
        try {
          result = await runQueryViaConnector(req.envId, connectorId, plan.sql);
        } catch (err) {
          result = { ok: false, error: (err as Error).message };
        }
        toolTrace.push({
          tool: 'db.query',
          connector_id: connectorId,
          input: plan.sql,
          ok: result.ok,
          rows_returned: result.rows_returned,
          truncated: result.truncated,
          latency_ms: result.latency_ms,
          error: result.error,
          reason: plan.reason,
        });
        if (result.ok) {
          queryResultBlock = `\n\nLIVE QUERY RESULT
----------------------------------------
QUERY: ${plan.sql}
ROWS RETURNED: ${result.rows_returned ?? 0}${result.truncated ? ' (truncated)' : ''}

${result.rows_text}
----------------------------------------
When you cite this result, reference it as [query].`;
        } else {
          queryResultBlock = `\n\nLIVE QUERY ATTEMPTED
----------------------------------------
QUERY: ${plan.sql}
ERROR: ${result.error ?? 'unknown'}
Do not invent a result. Tell the user the query couldn't complete and why.`;
        }
      } else {
        toolTrace.push({
          tool: 'db.query',
          connector_id: connectorId,
          input: '',
          ok: false,
          reason: plan.reason,
        });
      }
    }
  }

  const augmented: OpenAIMessage[] = [
    {
      role: 'system',
      content: SYSTEM_TEMPLATE(buildContextBlock(usableChunks)) + queryResultBlock,
    },
    ...req.messages,
  ];

  let resp: ChatResponse;
  try {
    resp = await chatComplete(chatProvider, model, augmented, {
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
    usableChunks.length,
    usableChunks.length === 0 ? 'no_grounded_context' : 'ok',
  ).catch((err) => log?.warn({ err }, 'request_log_insert_failed'));

  // Citations reflect what we actually grounded on — same set the model saw.
  return {
    ...resp,
    argus_citations: usableChunks.map((c, i) => ({
      index: i + 1,
      chunk_id: c.chunk_id,
      source_id: c.source_id,
      source_title: c.source_title,
      source_kind: c.source_kind,
      score: c.score,
    })),
    ...(toolTrace.length > 0 ? { argus_tool_trace: toolTrace } : {}),
    ...(usableChunks.length === 0 ? { argus_warning: 'no_grounded_context' as const } : {}),
  };
}
