import { z } from 'zod';

const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  ingestToken: z.string().min(1, 'ARGUS_INGEST_TOKEN is required'),

  databaseUrl: z.string().url(),
  redisUrl: z.string().url(),

  apiPort: z.coerce.number().int().positive().default(4000),
  apiPublicUrl: z.string().url().default('http://localhost:4000'),

  defaultAiProvider: z
    .enum(['claude', 'openai', 'gemini', 'ollama', 'deepseek', 'mock'])
    .default('claude'),

  claudeApiKey: z.string().optional(),
  claudeModel: z.string().default('claude-opus-4-7'),

  openaiApiKey: z.string().optional(),
  openaiModel: z.string().default('gpt-4.1'),

  geminiApiKey: z.string().optional(),
  geminiModel: z.string().default('gemini-2.5-pro'),

  ollamaBaseUrl: z.string().url().default('http://host.docker.internal:11434'),
  ollamaModel: z.string().default('llama3.1'),

  deepseekApiKey: z.string().optional(),
  deepseekModel: z.string().default('deepseek-chat'),

  slackWebhookUrl: z.string().url().optional(),

  telemetry: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Read and validate environment configuration.
 * Throws on first call if required values are missing — fail-fast at boot.
 *
 * Note: empty-string env vars are treated as unset. `.env` files commonly leave
 * placeholders like `ARGUS_SLACK_WEBHOOK_URL=` in place; Zod's `.url().optional()`
 * would reject those without this normalization.
 */
const env = (key: string): string | undefined => {
  const v = process.env[key];
  return v === undefined || v === '' ? undefined : v;
};

let cached: Config | null = null;
export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.parse({
    nodeEnv: env('NODE_ENV'),
    logLevel: env('ARGUS_LOG_LEVEL'),
    ingestToken: env('ARGUS_INGEST_TOKEN'),
    databaseUrl: env('DATABASE_URL'),
    redisUrl: env('REDIS_URL'),
    apiPort: env('API_PORT'),
    apiPublicUrl: env('API_PUBLIC_URL'),
    defaultAiProvider: env('ARGUS_DEFAULT_AI_PROVIDER'),
    claudeApiKey: env('ARGUS_CLAUDE_API_KEY'),
    claudeModel: env('ARGUS_CLAUDE_MODEL'),
    openaiApiKey: env('ARGUS_OPENAI_API_KEY'),
    openaiModel: env('ARGUS_OPENAI_MODEL'),
    geminiApiKey: env('ARGUS_GEMINI_API_KEY'),
    geminiModel: env('ARGUS_GEMINI_MODEL'),
    ollamaBaseUrl: env('ARGUS_OLLAMA_BASE_URL'),
    ollamaModel: env('ARGUS_OLLAMA_MODEL'),
    deepseekApiKey: env('ARGUS_DEEPSEEK_API_KEY'),
    deepseekModel: env('ARGUS_DEEPSEEK_MODEL'),
    slackWebhookUrl: env('ARGUS_SLACK_WEBHOOK_URL'),
    telemetry: env('ARGUS_TELEMETRY'),
  });
  cached = parsed;
  return parsed;
}
