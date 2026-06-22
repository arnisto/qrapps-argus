/**
 * Groq provider — chat completions only.
 *
 * Groq exposes an OpenAI-compatible endpoint at /openai/v1/chat/completions
 * with `Authorization: Bearer gsk_…`. Response shape is already OpenAI's, so
 * we mostly pass-through, just patching in our `_argus` metadata for the
 * shared request-log path.
 *
 * Groq has NO embedding endpoint — embeddings always go through Gemini
 * (see llm/gemini.ts and the vector(768) schema in migration 0007).
 */

import type { ChatOpts, ChatResponse, OpenAIMessage, ProviderRow } from './gemini.js';

// $/1M tokens. Tune as Groq pricing moves.
const PRICING: Record<string, { in: number; out: number }> = {
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
  'llama-3.1-70b-versatile': { in: 0.59, out: 0.79 },
  'llama-3.1-8b-instant': { in: 0.05, out: 0.08 },
  'mixtral-8x7b-32768': { in: 0.24, out: 0.24 },
};

function priceFor(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model] ?? { in: 0, out: 0 };
  return +((inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out).toFixed(6);
}

function groqBase(p: ProviderRow): string {
  return p.base_url || 'https://api.groq.com';
}

/**
 * Strip any leading "groq/" namespace so callers can pass either
 * "llama-3.3-70b-versatile" or "groq/llama-3.3-70b-versatile" — the
 * router prefers the prefixed form for disambiguation; Groq's API
 * expects the bare model id.
 */
function bareModel(model: string): string {
  return model.startsWith('groq/') ? model.slice('groq/'.length) : model;
}

export async function complete(
  p: ProviderRow,
  model: string,
  messages: OpenAIMessage[],
  opts: ChatOpts = {},
): Promise<ChatResponse> {
  const url = `${groqBase(p)}/openai/v1/chat/completions`;
  const real = bareModel(model);

  const body = {
    model: real,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.max_tokens ?? 4096,
  };

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${p.api_key}`,
    },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    throw new Error(`Groq ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as ChatResponse;
  // Patch in our _argus metadata using Groq's reported usage.
  const usage = data.usage ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  return {
    ...data,
    model: real,
    _argus: {
      provider: 'groq',
      model: real,
      latency_ms: elapsed,
      cost_usd_estimate: priceFor(real, usage.prompt_tokens, usage.completion_tokens),
    },
  };
}
