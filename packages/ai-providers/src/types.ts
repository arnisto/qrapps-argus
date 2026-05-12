export type ProviderId = 'claude' | 'openai' | 'gemini' | 'ollama' | 'deepseek' | 'mock';

export interface CompletionRequest {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** When set, the provider must return JSON parseable against this schema. */
  responseSchema?: JSONSchema;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface CompletionResponse {
  text: string;
  /** Populated when `responseSchema` was provided. */
  parsedJson?: unknown;
  usage: { inputTokens: number; outputTokens: number };
  /** Raw provider response, for logging/debugging. Never relied upon. */
  raw: unknown;
}

export interface AIProvider {
  readonly id: ProviderId;
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

/**
 * A subset of JSON Schema we standardize on. Each provider translates this
 * into its native structured-output shape (Anthropic tool input, OpenAI
 * json_schema response_format, Gemini response schema, etc.).
 */
export type JSONSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  description?: string;
  additionalProperties?: boolean | JSONSchema;
};
