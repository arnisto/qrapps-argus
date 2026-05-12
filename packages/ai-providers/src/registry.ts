import { loadConfig, ProviderError } from '@argus/shared';
import type { AIProvider, ProviderId } from './types.js';
import { ClaudeProvider } from './claude/index.js';
import { OpenAIProvider } from './openai/index.js';
import { GeminiProvider } from './gemini/index.js';
import { MockProvider } from './mock/index.js';

/**
 * Optional explicit credentials. When the caller has already resolved a key
 * from the DB (`llm_credentials` table) it passes the resolved `apiKey` /
 * `model` here, and the registry skips env-var lookup entirely.
 *
 * When omitted, the registry falls back to env vars — same behavior as v0.2.
 * That fallback keeps fresh installs working before any credential rows are
 * created and supports CI / one-key deployments.
 */
export interface ResolvedCredentials {
  apiKey?: string;
  model?: string;
}

/**
 * Resolve a provider instance by id. Backward-compatible — the third arg is
 * optional, and when omitted env-var keys are used (legacy v0.2 behavior).
 */
export function getProvider(
  id?: ProviderId,
  modelOverride?: string,
  creds?: ResolvedCredentials,
): AIProvider {
  const config = loadConfig();
  const resolved: ProviderId = id ?? config.defaultAiProvider;
  const givenKey = creds?.apiKey;
  const givenModel = creds?.model ?? modelOverride;

  switch (resolved) {
    case 'claude': {
      const apiKey = givenKey ?? config.claudeApiKey;
      if (!apiKey) {
        throw new ProviderError(
          'No Claude API key available. Add one via /credentials or set ARGUS_CLAUDE_API_KEY.',
        );
      }
      return new ClaudeProvider({ apiKey, model: givenModel ?? config.claudeModel });
    }

    case 'openai': {
      const apiKey = givenKey ?? config.openaiApiKey;
      if (!apiKey) {
        throw new ProviderError(
          'No OpenAI API key available. Add one via /credentials or set ARGUS_OPENAI_API_KEY.',
        );
      }
      return new OpenAIProvider({ apiKey, model: givenModel ?? config.openaiModel });
    }

    case 'gemini': {
      const apiKey = givenKey ?? config.geminiApiKey;
      if (!apiKey) {
        throw new ProviderError(
          'No Gemini API key available. Add one via /credentials or set ARGUS_GEMINI_API_KEY.',
        );
      }
      return new GeminiProvider({ apiKey, model: givenModel ?? config.geminiModel });
    }

    case 'mock':
      return new MockProvider();

    case 'ollama':
    case 'deepseek':
      throw new ProviderError(`provider "${resolved}" is scaffolded but lands fully in v0.3`);

    default: {
      const _exhaustive: never = resolved;
      throw new ProviderError(`unknown provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Test that a candidate API key actually works by issuing a 1-token completion.
 * Used by the credentials CRUD's "Test key" button before persisting.
 */
export async function testCredential(opts: {
  provider: ProviderId;
  apiKey: string;
  model?: string;
}): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    const provider = getProvider(opts.provider, opts.model, { apiKey: opts.apiKey });
    const r = await provider.complete({
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      maxTokens: 8,
      temperature: 0,
    });
    return { ok: true, model: provider.model, error: r.text.slice(0, 60) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
