import { buildTriggerBlock, buildEventsBlock, FINDING_RULES } from '../prompt.js';
import type { Agent, AgentOutput, PipelineRunInput } from './types.js';

/**
 * Render the system + user prompt for one agent in a pipeline.
 *
 * Compared to the legacy `buildPrompt`, this prompt:
 *   - uses the agent's own `system_prompt` rather than the investigator's checks
 *   - tells the model which position it occupies in the pipeline
 *   - includes outputs from prior agents (filtered by `reads_from`)
 *   - appends the standard Finding rules only for the final `finding`-kind agent
 */
export function buildAgentPrompt(opts: {
  input: PipelineRunInput;
  agent: Agent & { reads_from: 'all' | string[] };
  position: number;
  totalAgents: number;
  priorOutputs: AgentOutput[];
}): { system: string; user: string } {
  const { input, agent, position, totalAgents, priorOutputs } = opts;

  const allowedPriors = filterPriorOutputs(priorOutputs, agent.reads_from);

  const systemLines = [
    agent.system_prompt,
    '',
    `You are agent "${agent.id}" — position ${position + 1} of ${totalAgents} in a pipeline of agents working on the same investigation.`,
    `Your output schema kind is "${agent.output_schema_kind}".`,
  ];

  if (agent.output_schema_kind === 'finding') {
    systemLines.push('', 'Finding rules (mandatory):', FINDING_RULES);
  } else if (agent.output_schema_kind === 'analysis') {
    systemLines.push(
      '',
      'Output rules:',
      '- Each entry in `findings` is a short matched-pattern description.',
      '- Cite the relevant event_id(s) in parentheses at the end of each entry.',
      '- Use `notes` for confidence / caveats / what you could not determine.',
      '- Do NOT invent event_ids that are not in the context.',
    );
  } else {
    systemLines.push(
      '',
      'Output rules:',
      '- Respond with concise, structured prose.',
      '- Cite event_ids inline when referring to specific events.',
      '- Do NOT invent event_ids that are not in the context.',
    );
  }

  const userParts: string[] = [
    `Investigation: ${input.pipeline.name}`,
    `Scope: ${input.pipeline.description}`,
    '',
    buildTriggerBlock({ context: input.pipeline.context }, input.trigger),
    '',
    buildEventsBlock(input.contextEvents),
  ];

  if (allowedPriors.length > 0) {
    userParts.push('', 'Prior agent outputs:', formatPriorOutputs(allowedPriors));
  }

  if (agent.user_prompt_template) {
    userParts.push('', agent.user_prompt_template);
  }

  // Closing instruction varies by kind so the model knows what to emit.
  userParts.push(
    '',
    agent.output_schema_kind === 'finding'
      ? 'Emit a single finding via the structured output.'
      : agent.output_schema_kind === 'analysis'
        ? 'Emit your analysis via the structured output.'
        : 'Respond with text only — no JSON wrapper.',
  );

  return { system: systemLines.join('\n'), user: userParts.join('\n') };
}

function filterPriorOutputs(
  priors: AgentOutput[],
  readsFrom: 'all' | string[],
): AgentOutput[] {
  if (readsFrom === 'all') return priors;
  const allowed = new Set(readsFrom);
  return priors.filter((p) => allowed.has(p.agent_id));
}

function formatPriorOutputs(priors: AgentOutput[]): string {
  return priors
    .map((p) => {
      const header = `--- agent "${p.agent_id}" (kind: ${p.kind}) ---`;
      const body =
        p.kind === 'text' || p.json === undefined ? p.text : JSON.stringify(p.json, null, 2);
      return `${header}\n${body}`;
    })
    .join('\n\n');
}
