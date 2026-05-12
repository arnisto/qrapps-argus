import OpenAI from 'openai';
import { ProviderError } from '@argus/shared';
import type { AIProvider, CompletionRequest, CompletionResponse } from '../types.js';

/**
 * OpenAI provider — uses `response_format: { type: 'json_schema' }` to enforce
 * structured output when `responseSchema` is provided.
 */
export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(opts: { apiKey: string; model: string; baseURL?: string }) {
    this.model = opts.model;
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.stopSequences ? { stop: req.stopSequences } : {}),
    };

    if (req.responseSchema) {
      params.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'finding',
          strict: true,
          schema: req.responseSchema as Record<string, unknown>,
        },
      };
    }

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];
    if (!choice) throw new ProviderError('openai: empty choices array');
    const text = choice.message.content ?? '';

    let parsedJson: unknown;
    if (req.responseSchema) {
      try {
        parsedJson = JSON.parse(text);
      } catch (err) {
        throw new ProviderError('openai: response was not valid JSON', err, { text });
      }
    }

    return {
      text,
      ...(parsedJson !== undefined ? { parsedJson } : {}),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      raw: response,
    };
  }
}
