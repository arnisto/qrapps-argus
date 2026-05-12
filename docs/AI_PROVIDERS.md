# AI Providers

Argus runs on a **provider abstraction**. No investigator is allowed to import a vendor SDK directly. Reasoning is dispatched through `packages/ai-providers`.

## Why

Three reasons:

1. **No vendor lock-in.** A self-hoster who wants to run on Ollama must be able to. A team that prefers Claude must be able to. Same investigators, different brains.
2. **Cost / quality tuning.** Cheap provider for high-volume investigators, premium for the executive summarizer.
3. **Testability.** A `mock` provider lets us run investigator tests deterministically.

## Provider interface

```ts
export interface AIProvider {
  id: string;          // 'claude' | 'openai' | 'gemini' | 'ollama' | 'deepseek' | 'mock'
  model: string;       // resolved model id

  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

export interface CompletionRequest {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  responseSchema?: JSONSchema;     // when set, provider must return JSON matching it
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface CompletionResponse {
  text: string;
  parsedJson?: unknown;            // populated when responseSchema was provided
  usage: { inputTokens: number; outputTokens: number };
  raw: unknown;                    // provider-specific raw response, for logging
}
```

That's the whole contract. Anything provider-specific (tool use, vision, streaming) lives behind this interface or doesn't ship.

## Shipping providers

| Provider   | v0.1   | Default model             | Notes                                              |
| ---------- | ------ | ------------------------- | -------------------------------------------------- |
| `claude`   | ✅     | `claude-opus-4-7`         | Anthropic SDK; structured output via tool-use.     |
| `openai`   | ✅     | `gpt-4.1`                 | Function calling / `response_format: json_schema`. |
| `gemini`   | ✅     | `gemini-2.5-pro`          | `@google/genai` SDK; `responseMimeType` + `responseSchema`. Schema is sanitized to Gemini's OpenAPI-3.0 dialect. |
| `ollama`   | scaffold | configurable           | Local inference; Argus self-hosters' favorite.     |
| `deepseek` | scaffold | configurable           | Cost-efficient option.                             |
| `mock`     | ✅     | n/a                       | Test-only; returns canned responses for fixtures.  |

## Configuration

Global default:

```env
ARGUS_DEFAULT_AI_PROVIDER=claude
ARGUS_CLAUDE_API_KEY=sk-ant-...
ARGUS_OPENAI_API_KEY=sk-...
```

Per-investigator override (in YAML):

```yaml
provider: openai
model: gpt-4.1   # optional — falls back to provider default
```

## Structured output is mandatory

Investigators **always** call `complete()` with a `responseSchema`. Free-text findings are not accepted by the runtime. Each provider implementation is responsible for translating the schema into:

- Anthropic: tool use with a single tool whose input schema is the response schema
- OpenAI: function calling / `response_format: json_schema`
- Gemini: `responseMimeType: application/json` + `responseSchema` (sanitized to OpenAPI-3.0 subset — Argus strips `additionalProperties`, `$schema`, etc. that Gemini rejects)
- Ollama: structured outputs (where supported) or schema-in-prompt fallback
- DeepSeek: same approach as OpenAI

If the provider returns invalid JSON, the runtime retries once with a corrective prompt, then fails the investigation (logs the failure, no alert).

## Adding a new provider

1. Create `packages/ai-providers/src/<name>/index.ts` exporting a class implementing `AIProvider`.
2. Add config schema in `packages/ai-providers/src/<name>/config.ts`.
3. Register in `packages/ai-providers/src/registry.ts`.
4. Add at least one fixture-based test in `packages/ai-providers/src/<name>/__tests__/`.
5. Document env vars in `.env.example` and `docs/AI_PROVIDERS.md` (this file).

## What providers must never do

- ❌ Mutate state outside their own module.
- ❌ Log secrets, even at debug level.
- ❌ Silently swap models without surfacing the choice in `CompletionResponse.raw`.
- ❌ Add provider-specific knobs that bypass the interface.
