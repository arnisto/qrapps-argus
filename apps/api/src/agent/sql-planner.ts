/**
 * SQL planner — the brain that decides whether the user's question is
 * answerable from live SQL, and if so, drafts the query.
 *
 * Input: the question + the db_schema chunks retrieved for it.
 * Output:
 *   · { sql: 'SELECT …', reason: 'why' }  — the model thinks a query helps
 *   · { sql: null, reason: 'why no query' } — schema chunks already
 *     contain the answer, OR the question isn't data-shaped
 *
 * Single-shot LLM call with strict JSON output. We do NOT use Gemini's
 * structured-output flag (free tier flakiness); we parse the JSON
 * ourselves and re-prompt once on parse failure.
 */
import { complete, type OpenAIMessage, type ProviderRow } from '../llm/gemini.js';
import type { RetrievedChunk } from '../llm/retrieve.js';
import { chatComplete } from '../llm/router.js';

export interface SqlPlan {
  sql: string | null;
  reason: string;
}

const PLANNER_SYSTEM = `You are a SQL planning assistant for a Postgres database. Given a user's question and the relevant schema, decide whether running a single SELECT query would help answer it.

REPLY RULES (very important):
- Output ONLY valid JSON. No markdown fences, no prose before or after.
- One of these two shapes:
    {"sql": "SELECT ... LIMIT 100", "reason": "..."}
    {"sql": null, "reason": "..."}
- "sql" MUST be a single SELECT / WITH / EXPLAIN statement. Never INSERT / UPDATE / DELETE / DROP / GRANT / TRUNCATE / ALTER.
- Never include a trailing semicolon.
- ALWAYS add LIMIT 100 unless the query is a pure aggregate (count/sum/avg/etc).
- Quote identifiers with double-quotes if they need it.
- Prefer aggregates over raw row dumps for "how many" / "average" / "total" questions.
- If the schema doesn't contain columns needed to answer, return {"sql": null, "reason": "..."}.
- If the question is purely about schema shape ("what columns does X have"), the chunks already contain the answer — return {"sql": null, "reason": "schema-only question"}.
- Do NOT invent table or column names. Only use what appears in the schema.`;

function buildSchemaBlock(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => `--- [${i + 1}] ${c.source_title} (${c.source_kind}, score=${c.score})\n${c.content}`)
    .join('\n\n');
}

export async function planSql(
  provider: ProviderRow,
  model: string,
  question: string,
  chunks: RetrievedChunk[],
): Promise<SqlPlan> {
  if (chunks.length === 0) {
    return { sql: null, reason: 'no schema chunks retrieved' };
  }

  const messages: OpenAIMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM },
    {
      role: 'user',
      content: `QUESTION:\n${question}\n\nSCHEMA:\n${buildSchemaBlock(chunks)}`,
    },
  ];

  let resp;
  try {
    resp = await chatComplete(provider, model, messages, { temperature: 0, max_tokens: 1024 });
  } catch {
    // Provider failed; act as if no SQL is needed and let the standard
    // grounded-answer path do its best with the schema chunks alone.
    return { sql: null, reason: 'planner_provider_failed' };
  }

  const text = resp.choices?.[0]?.message?.content?.trim() ?? '';
  const parsed = tryParse(text);
  if (parsed) return sanitize(parsed);

  // Re-prompt once with the original output to coax JSON. Worth one retry;
  // any more and the latency hit isn't worth the gain.
  try {
    const retry = await chatComplete(
      provider,
      model,
      [
        ...messages,
        { role: 'assistant', content: text },
        {
          role: 'user',
          content:
            'That was not valid JSON. Reply ONLY with valid JSON in the schema described — no fences, no prose.',
        },
      ],
      { temperature: 0, max_tokens: 512 },
    );
    const parsed2 = tryParse(retry.choices?.[0]?.message?.content?.trim() ?? '');
    if (parsed2) return sanitize(parsed2);
  } catch {
    // fall through
  }
  return { sql: null, reason: 'planner_returned_unparseable_output' };
}

function tryParse(text: string): unknown | null {
  if (!text) return null;
  // Strip ```json fences if the model added them anyway.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Try to find the first { ... } object.
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function sanitize(raw: unknown): SqlPlan {
  if (!raw || typeof raw !== 'object') {
    return { sql: null, reason: 'planner_returned_non_object' };
  }
  const obj = raw as Record<string, unknown>;
  const sql = obj.sql;
  const reason = typeof obj.reason === 'string' ? obj.reason : '';
  if (sql === null || sql === undefined || sql === '') {
    return { sql: null, reason };
  }
  if (typeof sql !== 'string') {
    return { sql: null, reason: 'planner_returned_non_string_sql' };
  }
  return { sql: sql.trim().replace(/;\s*$/, ''), reason };
}

void complete; // touched for unused-import lint protection
