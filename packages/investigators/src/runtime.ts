import { childLogger, InvestigatorError, meetsThreshold } from '@argus/shared';
import type { Event } from '@argus/events';
import { getProvider } from '@argus/ai-providers';
import type { InvestigatorDefinition } from './definition.js';
import { buildPrompt } from './prompt.js';
import { FINDING_RESPONSE_SCHEMA, FindingSchema, type Finding } from './types.js';

export interface RunInput {
  definition: InvestigatorDefinition;
  trigger: { kind: 'event' | 'schedule'; event?: Event };
  contextEvents: Event[];
}

export interface RunResult {
  finding: Finding;
  /** True iff severity meets the investigator's threshold (caller alerts on this). */
  shouldAlert: boolean;
  usage: { inputTokens: number; outputTokens: number };
  provider: string;
  model: string;
}

/**
 * Execute one investigator run.
 *
 *   1. Build the prompt from the definition + context events.
 *   2. Call the configured AI provider with the Finding response schema.
 *   3. Parse + validate the structured response into a Finding.
 *   4. Compare severity against the investigator threshold.
 *
 * The runtime does not persist anything and does not dispatch alerts —
 * those are the caller's responsibility (apps/workers).
 */
export async function runInvestigator(input: RunInput): Promise<RunResult> {
  const log = childLogger({ investigator_id: input.definition.id });
  const provider = getProvider(input.definition.provider, input.definition.model);

  const { system, user } = buildPrompt(input);

  log.debug({ events: input.contextEvents.length, provider: provider.id }, 'investigator.run.start');

  const response = await provider.complete({
    system,
    messages: [{ role: 'user', content: user }],
    responseSchema: FINDING_RESPONSE_SCHEMA,
    temperature: 0,
    // Bumped to 4096 because Gemini 2.5 reasoning models consume budget on
    // thinking before any output tokens are emitted; 1500 was getting truncated.
    maxTokens: 4096,
  });

  if (response.parsedJson === undefined) {
    throw new InvestigatorError('provider returned no structured output', undefined, {
      investigator_id: input.definition.id,
    });
  }

  const parsed = FindingSchema.safeParse({
    investigator_id: input.definition.id,
    ...(response.parsedJson as Record<string, unknown>),
  });

  if (!parsed.success) {
    throw new InvestigatorError('provider response failed Finding validation', parsed.error, {
      investigator_id: input.definition.id,
      issues: parsed.error.issues,
    });
  }

  const finding = parsed.data;

  // Sanity check: every cited event_id must exist in the context window.
  const knownIds = new Set(input.contextEvents.map((e) => e.event_id));
  for (const ev of finding.evidence) {
    if (!knownIds.has(ev.event_id)) {
      throw new InvestigatorError('finding cites an event_id outside the context window', undefined, {
        investigator_id: input.definition.id,
        cited: ev.event_id,
      });
    }
  }

  const shouldAlert = meetsThreshold(finding.severity, input.definition.severity_threshold);

  log.info(
    { severity: finding.severity, evidence_count: finding.evidence.length, shouldAlert },
    'investigator.run.finished',
  );

  return {
    finding,
    shouldAlert,
    usage: response.usage,
    provider: provider.id,
    model: provider.model,
  };
}
