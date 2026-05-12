import type { AIProvider, CompletionRequest, CompletionResponse } from '../types.js';

/**
 * Test-only provider. Returns canned responses so investigator tests can run
 * deterministically without network access.
 *
 * Set responses via `MockProvider.queue([...])` before invoking the SUT.
 */
export class MockProvider implements AIProvider {
  readonly id = 'mock' as const;
  readonly model = 'mock-1';

  private static queued: CompletionResponse[] = [];

  static queue(responses: Array<Partial<CompletionResponse> & { parsedJson?: unknown; text?: string }>): void {
    MockProvider.queued = responses.map((r) => ({
      text: r.text ?? '',
      ...(r.parsedJson !== undefined ? { parsedJson: r.parsedJson } : {}),
      usage: r.usage ?? { inputTokens: 0, outputTokens: 0 },
      raw: r.raw ?? {},
    }));
  }

  static reset(): void {
    MockProvider.queued = [];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    const next = MockProvider.queued.shift();
    if (!next) {
      return {
        text: '',
        parsedJson: { severity: 'none', summary: 'mock: no response queued', evidence: [] },
        usage: { inputTokens: 0, outputTokens: 0 },
        raw: {},
      };
    }
    return next;
  }
}
