import { GoogleGenAI } from '@google/genai';
import { ProviderError } from '@argus/shared';
import type { AIProvider, CompletionRequest, CompletionResponse, JSONSchema } from '../types.js';

/**
 * Gemini provider — uses the unified `@google/genai` SDK.
 *
 * Structured output is enforced via `responseMimeType: 'application/json'` +
 * `responseSchema`. Gemini's accepted schema dialect is OpenAPI-3.0-flavored
 * JSON Schema; we sanitize Argus's stricter form before sending.
 */
export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(opts: { apiKey: string; model: string }) {
    this.model = opts.model;
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const config: Record<string, unknown> = {};
    if (req.system) config['systemInstruction'] = req.system;
    if (req.temperature !== undefined) config['temperature'] = req.temperature;
    if (req.maxTokens !== undefined) config['maxOutputTokens'] = req.maxTokens;
    if (req.stopSequences) config['stopSequences'] = req.stopSequences;

    if (req.responseSchema) {
      config['responseMimeType'] = 'application/json';
      config['responseSchema'] = sanitizeForGemini(req.responseSchema);
      // Disable thinking budget for structured output. Gemini 2.5 reasoning
      // models otherwise burn maxOutputTokens on internal deliberation before
      // emitting any JSON, truncating findings mid-sentence. The schema is
      // enough steering for our structured-finding case.
      config['thinkingConfig'] = { thinkingBudget: 0 };
    }

    // Gemini chat roles: 'user' and 'model' (not 'assistant').
    const contents = req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config,
    });

    const text = response.text ?? '';
    let parsedJson: unknown;
    if (req.responseSchema) {
      if (!text) throw new ProviderError('gemini: empty response despite responseSchema');
      try {
        parsedJson = JSON.parse(text);
      } catch (err) {
        throw new ProviderError('gemini: response was not valid JSON', err, { text });
      }
    }

    return {
      text,
      ...(parsedJson !== undefined ? { parsedJson } : {}),
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      raw: response,
    };
  }
}

/**
 * Strip JSON-Schema fields that Gemini's schema dialect rejects.
 *
 * Gemini accepts an OpenAPI-3.0 subset: type, properties, required, items,
 * enum, description, format, nullable. It rejects: additionalProperties,
 * $schema, $ref, allOf/oneOf/anyOf. We walk the schema and drop the offenders.
 */
function sanitizeForGemini(schema: JSONSchema): Record<string, unknown> {
  const allowed = new Set([
    'type',
    'properties',
    'required',
    'items',
    'enum',
    'description',
    'format',
    'nullable',
  ]);

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (!allowed.has(k)) continue;
        if (k === 'properties' && v && typeof v === 'object') {
          const props: Record<string, unknown> = {};
          for (const [pk, pv] of Object.entries(v)) props[pk] = walk(pv);
          out[k] = props;
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  };

  return walk(schema) as Record<string, unknown>;
}
