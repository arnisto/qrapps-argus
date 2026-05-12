import Anthropic from '@anthropic-ai/sdk';
import { ProviderError } from '@argus/shared';
import type { AIProvider, CompletionRequest, CompletionResponse } from '../types.js';

/**
 * Claude provider — uses Anthropic's tool-use mechanism to enforce structured
 * output when `responseSchema` is provided. The investigator runtime relies
 * on this; freeform findings are not accepted.
 */
export class ClaudeProvider implements AIProvider {
  readonly id = 'claude' as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey: string; model: string; baseURL?: string }) {
    this.model = opts.model;
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const baseParams = {
      model: this.model,
      max_tokens: req.maxTokens ?? 2048,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(req.stopSequences ? { stop_sequences: req.stopSequences } : {}),
    };

    if (req.responseSchema) {
      const tool: Anthropic.Tool = {
        name: 'emit_finding',
        description: 'Emit the structured finding. Always call exactly once.',
        // Anthropic tool input_schema is JSON Schema-compatible. Argus only
        // ever passes object-typed schemas here (Findings); narrow the cast.
        input_schema: req.responseSchema as unknown as Anthropic.Tool.InputSchema,
      };
      const response = await this.client.messages.create({
        ...baseParams,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
      });

      const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!toolUse) throw new ProviderError('claude: no tool_use block in response');

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      return {
        text,
        parsedJson: toolUse.input,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        raw: response,
      };
    }

    const response = await this.client.messages.create(baseParams);
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      raw: response,
    };
  }
}
