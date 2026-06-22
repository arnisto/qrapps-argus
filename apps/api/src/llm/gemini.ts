/**
 * Gemini provider — chat completion + embedding.
 *
 *   complete(p, model, messages, opts) -> OpenAI-shaped response
 *   embed(p, texts, dim)               -> number[][]
 *
 * Returns the response augmented with `_argus` (provider name, latency,
 * token cost estimate) so the caller can write a `requests` row without
 * re-deriving anything.
 *
 * Free-tier quirk: `gemini-2.5-flash` requires `thinkingConfig:
 * { thinkingBudget: 0 }` for the structured-output path to behave; we
 * pass it on every chat call to keep the contract uniform.
 */

export interface ProviderRow {
  name: string;
  base_url: string | null;
  default_model: string;
  api_key: string;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOpts {
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  _argus?: {
    provider: 'gemini';
    model: string;
    latency_ms: number;
    cost_usd_estimate: number;
  };
}

// $/1M tokens. Tune as Gemini pricing moves.
const PRICING: Record<string, { in: number; out: number }> = {
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-pro': { in: 1.25, out: 10.0 },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
};

function priceFor(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model] ?? { in: 0, out: 0 };
  return +((inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out).toFixed(6);
}

function geminiBase(p: ProviderRow): string {
  return p.base_url || 'https://generativelanguage.googleapis.com';
}

export async function complete(
  p: ProviderRow,
  model: string,
  messages: OpenAIMessage[],
  opts: ChatOpts = {},
): Promise<ChatResponse> {
  const url = `${geminiBase(p)}/v1beta/models/${model}:generateContent?key=${p.api_key}`;

  // Translate OpenAI roles → Gemini contents (system → systemInstruction).
  let sys: string | null = null;
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      sys = (sys ? `${sys}\n` : '') + m.content;
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.max_tokens ?? 4096,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (sys) body.systemInstruction = { parts: [{ text: sys.trim() }] };

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates: Array<{
      content: { parts: Array<{ text: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const cand = data.candidates[0]!;
  const text = cand.content.parts.map((x) => x.text).join('');
  const um = data.usageMetadata ?? {};
  const promptTokens = um.promptTokenCount ?? 0;
  const completionTokens = (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0);
  const totalTokens = um.totalTokenCount ?? promptTokens + completionTokens;

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: (cand.finishReason ?? 'stop').toLowerCase(),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
    _argus: {
      provider: 'gemini',
      model,
      latency_ms: elapsed,
      cost_usd_estimate: priceFor(model, promptTokens, completionTokens),
    },
  };
}

/**
 * Gemini embedding. Default model = gemini-embedding-001 with
 * outputDimensionality=768 so vectors match the chunks.embedding vector(768)
 * column. Sequential calls — the free-tier endpoint doesn't batch.
 */
export async function embed(
  p: ProviderRow,
  texts: string[],
  dim = 768,
  model = 'gemini-embedding-001',
): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) {
    const url = `${geminiBase(p)}/v1beta/models/${model}:embedContent?key=${p.api_key}`;
    const body = {
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: dim,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Gemini embed ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { embedding: { values: number[] } };
    out.push(data.embedding.values);
  }
  return out;
}
