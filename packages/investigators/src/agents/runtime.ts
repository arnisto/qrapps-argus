import { childLogger, InvestigatorError, meetsThreshold } from '@argus/shared';
import { getProvider } from '@argus/ai-providers';
import { FindingSchema, type Finding } from '../types.js';
import { buildAgentPrompt } from './prompt.js';
import { OUTPUT_KIND_SPECS } from './schemas.js';
import type { AgentOutput, AgentRunRecord, PipelineRunInput, PipelineRunResult } from './types.js';

/**
 * Execute a linear multi-agent pipeline. Each agent runs after the previous,
 * receives the original context events plus the outputs of all prior agents
 * (filtered by its `reads_from`), and produces a structured output.
 *
 * Contract:
 *   - The pipeline MUST contain at least one agent.
 *   - The LAST agent MUST be of `output_schema_kind === 'finding'`; its output
 *     becomes the persisted Finding.
 *   - NO other agent may be of `finding` kind.
 *   - Cited `event_id`s in the final Finding must exist in `contextEvents`
 *     (same rule as the legacy single-call runtime).
 *
 * Failure semantics: any agent throwing aborts the pipeline. The error and the
 * partial trail of `AgentRunRecord`s are attached to the thrown
 * `InvestigatorError` so the worker can persist them and mark the
 * investigation failed.
 */
export async function runPipeline(input: PipelineRunInput): Promise<PipelineRunResult> {
  validatePipelineShape(input);

  const log = childLogger({ pipeline_id: input.pipeline.id });
  const priorOutputs: AgentOutput[] = [];
  const agentRuns: AgentRunRecord[] = [];
  let totalsInput = 0;
  let totalsOutput = 0;
  let finalFinding: Finding | null = null;
  let finalProvider = '';
  let finalModel = '';

  for (let i = 0; i < input.agents.length; i++) {
    const agent = input.agents[i]!;
    const position = i;
    const kind = agent.output_schema_kind;
    const spec = OUTPUT_KIND_SPECS[kind];
    // Pass through any pre-resolved credentials the worker loaded from
    // `llm_credentials`. When `apiKey` is undefined, getProvider falls back
    // to the env-var route (legacy v0.2 behavior).
    const provider = getProvider(agent.provider, agent.model, {
      apiKey: agent.apiKey,
      model: agent.apiKeyModel,
    });
    const { system, user } = buildAgentPrompt({
      input,
      agent,
      position,
      totalAgents: input.agents.length,
      priorOutputs,
    });

    const startedAt = new Date().toISOString();
    log.debug({ agent_id: agent.id, kind, position }, 'pipeline.agent.start');

    try {
      const response = await provider.complete({
        system,
        messages: [{ role: 'user', content: user }],
        ...(spec.responseSchema ? { responseSchema: spec.responseSchema } : {}),
        temperature: 0,
        maxTokens: 4096,
      });

      const finishedAt = new Date().toISOString();
      totalsInput += response.usage.inputTokens;
      totalsOutput += response.usage.outputTokens;

      // Build the per-kind output record and validate.
      let outputJson: unknown = null;
      let outputText = response.text;

      if (kind === 'text') {
        if (!outputText || outputText.trim().length === 0) {
          throw new InvestigatorError(`agent ${agent.id} (text) returned empty response`);
        }
      } else if (kind === 'analysis') {
        if (response.parsedJson === undefined) {
          throw new InvestigatorError(`agent ${agent.id} (analysis) returned no structured output`);
        }
        outputJson = spec.validate(response.parsedJson);
        // Mirror to text so the UI can show something readable even without expanding JSON.
        outputText = response.text || JSON.stringify(outputJson);
      } else {
        // kind === 'finding' — last agent
        if (response.parsedJson === undefined) {
          throw new InvestigatorError(`agent ${agent.id} (finding) returned no structured output`);
        }
        const parsed = FindingSchema.safeParse({
          investigator_id: input.pipeline.id,
          ...(response.parsedJson as Record<string, unknown>),
        });
        if (!parsed.success) {
          throw new InvestigatorError(
            `agent ${agent.id} (finding) failed Finding validation`,
            parsed.error,
            { issues: parsed.error.issues },
          );
        }
        finalFinding = parsed.data;
        outputJson = parsed.data;
        outputText = '';
        finalProvider = provider.id;
        finalModel = provider.model;
      }

      priorOutputs.push({
        agent_id: agent.id,
        position,
        kind,
        text: outputText,
        ...(outputJson !== null ? { json: outputJson } : {}),
      });

      agentRuns.push({
        agent_id: agent.id,
        position,
        status: 'succeeded',
        started_at: startedAt,
        finished_at: finishedAt,
        provider: provider.id,
        model: provider.model,
        system_prompt_rendered: system,
        user_prompt_rendered: user,
        output_json: outputJson,
        output_text: outputText,
        tokens_input: response.usage.inputTokens,
        tokens_output: response.usage.outputTokens,
        error: null,
      });

      log.info(
        {
          agent_id: agent.id,
          kind,
          position,
          tokens_in: response.usage.inputTokens,
          tokens_out: response.usage.outputTokens,
        },
        'pipeline.agent.finished',
      );
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const message = err instanceof Error ? err.message : String(err);

      agentRuns.push({
        agent_id: agent.id,
        position,
        status: 'failed',
        started_at: startedAt,
        finished_at: finishedAt,
        provider: provider.id,
        model: provider.model,
        system_prompt_rendered: system,
        user_prompt_rendered: user,
        output_json: null,
        output_text: '',
        tokens_input: 0,
        tokens_output: 0,
        error: message,
      });

      log.error({ err, agent_id: agent.id, position }, 'pipeline.agent.failed');

      // Abort the pipeline; surface the partial trail to the worker.
      throw new InvestigatorError(`pipeline failed at agent ${agent.id}: ${message}`, err, {
        pipeline_id: input.pipeline.id,
        failed_at_position: position,
        agent_runs: agentRuns,
      });
    }
  }

  if (!finalFinding) {
    throw new InvestigatorError('pipeline finished but produced no finding', undefined, {
      pipeline_id: input.pipeline.id,
      agent_runs: agentRuns,
    });
  }

  // Cited event_ids must exist in the context window — same rule as legacy runtime.
  const knownIds = new Set(input.contextEvents.map((e) => e.event_id));
  for (const ev of finalFinding.evidence) {
    if (!knownIds.has(ev.event_id)) {
      throw new InvestigatorError(
        'finding cites an event_id outside the context window',
        undefined,
        { pipeline_id: input.pipeline.id, cited: ev.event_id, agent_runs: agentRuns },
      );
    }
  }

  const shouldAlert = meetsThreshold(finalFinding.severity, input.pipeline.severity_threshold);

  return {
    finding: finalFinding,
    agentRuns,
    shouldAlert,
    totals: { inputTokens: totalsInput, outputTokens: totalsOutput },
    finalProvider,
    finalModel,
  };
}

/**
 * Enforce the "linear + exactly one finding at the end" contract before any
 * LLM call. Defensive against caller bugs (the API also validates at write
 * time, but the runtime double-checks).
 */
function validatePipelineShape(input: PipelineRunInput): void {
  if (input.agents.length === 0) {
    throw new InvestigatorError('pipeline must contain at least one agent');
  }
  const last = input.agents[input.agents.length - 1]!;
  if (last.output_schema_kind !== 'finding') {
    throw new InvestigatorError(
      `pipeline's last agent must be of kind 'finding', got '${last.output_schema_kind}'`,
    );
  }
  for (let i = 0; i < input.agents.length - 1; i++) {
    const a = input.agents[i]!;
    if (a.output_schema_kind === 'finding') {
      throw new InvestigatorError(
        `pipeline has more than one 'finding'-kind agent (at position ${i})`,
      );
    }
  }
}
