/**
 * Model → provider routing.
 *
 *   "gemini-2.5-flash"               → gemini
 *   "llama-3.3-70b-versatile"        → groq
 *   "mixtral-8x7b-32768"             → groq
 *   "groq/llama-3.1-8b-instant"      → groq (explicit prefix)
 *
 * Anything ambiguous falls back to gemini, since the schema requires
 * Gemini to be configured anyway (for embeddings).
 */
import * as gemini from './gemini.js';
import * as groq from './groq.js';
import type {
  ChatOpts,
  ChatResponse,
  OpenAIMessage,
  ProviderName,
  ProviderRow,
} from './gemini.js';

export type { ChatOpts, ChatResponse, OpenAIMessage, ProviderName, ProviderRow };

export function providerForModel(model: string): ProviderName {
  const m = (model || '').toLowerCase();
  if (m.startsWith('groq/')) return 'groq';
  if (m.startsWith('llama')) return 'groq';
  if (m.startsWith('mixtral')) return 'groq';
  if (m.startsWith('gemini') || m.startsWith('text-embedding') || m.startsWith('models/')) {
    return 'gemini';
  }
  return 'gemini';
}

export function chatComplete(
  p: ProviderRow,
  model: string,
  messages: OpenAIMessage[],
  opts: ChatOpts = {},
): Promise<ChatResponse> {
  switch (p.name) {
    case 'gemini':
      return gemini.complete(p, model, messages, opts);
    case 'groq':
      return groq.complete(p, model, messages, opts);
    default:
      throw new Error(`unknown provider: ${p.name}`);
  }
}
