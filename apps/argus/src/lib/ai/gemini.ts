import type { z } from 'zod'

/**
 * Minimal Gemini client for structured JSON output.
 * thinkingBudget=0 keeps structured output reliable on the flash models (empty or truncated JSON otherwise).
 */
export interface JsonCallResult<T> {
  data: T
  tokens: number
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface GeminiOptions {
  apiKey?: string
  model?: string
  temperature?: number
  fetchImpl?: FetchLike
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'no_key' | 'http' | 'parse' | 'schema',
  ) {
    super(message)
  }
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY)
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  return JSON.parse(trimmed)
}

export async function generateJson<S extends z.ZodType>(
  system: string,
  user: string,
  schema: S,
  opts: GeminiOptions = {},
): Promise<JsonCallResult<z.infer<S>>> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new AiError('GEMINI_API_KEY is not set', 'no_key')
  const model = opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  const doFetch = opts.fetchImpl ?? fetch

  let lastError: AiError | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? user : `${user}\n\nYour previous answer was not valid JSON for the schema. Return ONLY the JSON object.`
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: opts.temperature ?? 0.2,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new AiError(`Gemini ${res.status}: ${body.slice(0, 300)}`, 'http')
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: { totalTokenCount?: number }
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    const tokens = json.usageMetadata?.totalTokenCount ?? 0
    let parsed: unknown
    try {
      parsed = extractJson(text)
    } catch {
      lastError = new AiError('Gemini returned non-JSON text', 'parse')
      continue
    }
    const result = schema.safeParse(parsed)
    if (result.success) return { data: result.data, tokens }
    lastError = new AiError(`Gemini JSON failed the schema: ${result.error.message.slice(0, 300)}`, 'schema')
  }
  throw lastError ?? new AiError('Gemini call failed', 'parse')
}

/** Test helper: a fetch that returns the given object as Gemini's JSON text. */
export function fakeGeminiFetch(...answers: unknown[]): FetchLike {
  let i = 0
  return async () => {
    const answer = answers[Math.min(i++, answers.length - 1)]
    const text = typeof answer === 'string' ? answer : JSON.stringify(answer)
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { totalTokenCount: 42 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
}
