import type { Event } from '@argus/events';
import type { InvestigatorDefinition } from './definition.js';

/**
 * Standing rules every Finding-emitting prompt needs. Used by both the legacy
 * single-call `buildPrompt` and the per-agent prompt builder in `agents/prompt.ts`
 * (only for the `finding`-kind agent).
 */
export const FINDING_RULES = [
  '- Reason ONLY over the provided events.',
  '- Cite event_ids for every claim of evidence.',
  '- Return severity "none" if nothing matches the checks.',
  '- For severity >= medium, include an impact_estimate (currency, amount, basis).',
  '- Write the summary in plain business language, not technical jargon.',
  '- Never invent events or fields that are not in the input.',
].join('\n');

/** Trigger description line used at the top of the user prompt. */
export function buildTriggerBlock(
  definition: Pick<InvestigatorDefinition, 'context'>,
  trigger: { kind: 'event' | 'schedule'; event?: Event },
): string {
  return trigger.kind === 'event' && trigger.event
    ? `Triggered by event ${trigger.event.event_id} (${trigger.event.event_type}) at ${trigger.event.occurred_at}.`
    : `Triggered by scheduled run (lookback ${definition.context.lookback}).`;
}

/** Numbered listing of context events, identical format used everywhere. */
export function buildEventsBlock(contextEvents: Event[]): string {
  const body = contextEvents
    .map(
      (e, i) =>
        `[${i + 1}] event_id=${e.event_id} type=${e.event_type} at=${e.occurred_at}` +
        (e.subject ? ` subject=${e.subject.type}:${e.subject.id}` : '') +
        `\n     payload=${JSON.stringify(e.payload)}` +
        (e.tags ? `\n     tags=${JSON.stringify(e.tags)}` : ''),
    )
    .join('\n');
  return [
    `Context (${contextEvents.length} events, oldest first):`,
    body || '(no events in window)',
  ].join('\n');
}

/**
 * Build the prompt sent to the AI provider for a single (legacy) investigator
 * run. Multi-agent pipelines use `agents/prompt.ts::buildAgentPrompt` instead;
 * this remains the v1 fallback path.
 */
export function buildPrompt(opts: {
  definition: InvestigatorDefinition;
  trigger: { kind: 'event' | 'schedule'; event?: Event };
  contextEvents: Event[];
}): { system: string; user: string } {
  const { definition, trigger, contextEvents } = opts;

  const system = [
    `You are an Argus AI investigator named "${definition.name}".`,
    `Your scope: ${definition.description}`,
    '',
    'You MUST:',
    FINDING_RULES,
    '',
    'Checks you are responsible for:',
    // `checks` is required for v1 definitions but missing on v2 (pipeline).
    // buildPrompt is only called from the legacy single-call runtime, which
    // only fires for v1 definitions; defensive default for safety.
    ...(definition.checks ?? []).map((c) => `- ${c}`),
  ].join('\n');

  const user = [
    buildTriggerBlock(definition, trigger),
    '',
    buildEventsBlock(contextEvents),
    '',
    'Run your checks and emit a single finding via the structured output.',
  ].join('\n');

  return { system, user };
}
