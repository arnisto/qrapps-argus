import { z } from 'zod';
import { SeveritySchema } from '@argus/shared';
import type { Event } from '@argus/events';
import type { Finding } from '../types.js';

/**
 * An agent is one node in a linear pipeline. Each agent is its own LLM call
 * with its own provider+model and its own structured-output kind. Reusable
 * across multiple pipelines.
 */
export const OutputSchemaKindEnum = z.enum(['text', 'analysis', 'finding']);
export type OutputSchemaKind = z.infer<typeof OutputSchemaKindEnum>;

const ProviderIdEnum = z.enum(['claude', 'openai', 'gemini', 'ollama', 'deepseek', 'mock']);

export const AgentSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'agent id must be lowercase-kebab'),
  name: z.string().min(1),
  description: z.string().optional(),
  provider: ProviderIdEnum,
  model: z.string().min(1),
  system_prompt: z.string().min(1),
  user_prompt_template: z.string().optional(),
  output_schema_kind: OutputSchemaKindEnum,
  source: z.enum(['builtin', 'user']).default('user'),
});
export type Agent = z.infer<typeof AgentSchema>;

/** API body shape for POST /v1/agents. `id` is auto-derived from `name` if omitted. */
export const AgentCreateSchema = AgentSchema.omit({ id: true, source: true }).extend({
  id: AgentSchema.shape.id.optional(),
});
export type AgentCreate = z.infer<typeof AgentCreateSchema>;

/** Single entry in a pipeline. `reads_from` is reserved for v0.3 fine-grained filtering. */
export const PipelineAgentRefSchema = z.object({
  agent_id: z.string(),
  position: z.number().int().min(0),
  reads_from: z.union([z.literal('all'), z.array(z.string())]).default('all'),
});
export type PipelineAgentRef = z.infer<typeof PipelineAgentRefSchema>;

/**
 * v2 investigator (pipeline) body. Compared to v1, `checks` is gone (its job
 * moves into agent system prompts) and `provider`/`model` are gone (those live
 * on each agent). Everything else matches v1.
 */
export const InvestigatorV2Schema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  description: z.string().min(1),
  triggers: z.object({
    events: z.array(z.string()).default([]),
    schedule: z.string().optional(),
  }),
  context: z.object({
    lookback: z.string().regex(/^\d+(s|m|h|d)$/),
    related_events: z.array(z.string()).default([]),
    max_events: z.number().int().positive().max(2000).default(500),
  }),
  severity_threshold: SeveritySchema.default('medium'),
  output: z
    .object({ alert_channels: z.array(z.string()).default([]) })
    .default({ alert_channels: [] }),
  agents: z.array(PipelineAgentRefSchema).min(1),
});
export type InvestigatorV2 = z.infer<typeof InvestigatorV2Schema>;

/**
 * Per-agent execution result. The runtime accumulates these into the
 * `priorOutputs` map handed to subsequent agents.
 */
export interface AgentOutput {
  agent_id: string;
  position: number;
  kind: OutputSchemaKind;
  /** Raw text response (always set). */
  text: string;
  /** Validated structured output when `kind !== 'text'`. */
  json?: unknown;
}

/** What the runtime records to persist into `agent_runs`. */
export interface AgentRunRecord {
  agent_id: string;
  position: number;
  status: 'succeeded' | 'failed';
  started_at: string;
  finished_at: string;
  provider: string;
  model: string;
  system_prompt_rendered: string;
  user_prompt_rendered: string;
  output_json: unknown | null;
  output_text: string;
  tokens_input: number;
  tokens_output: number;
  error: string | null;
}

export interface PipelineRunInput {
  /** Pipeline header (v2 investigator). */
  pipeline: {
    id: string;
    name: string;
    description: string;
    context: { lookback: string; related_events: string[]; max_events: number };
    severity_threshold: 'none' | 'low' | 'medium' | 'high' | 'critical';
  };
  trigger: { kind: 'event' | 'schedule'; event?: Event };
  contextEvents: Event[];
  /**
   * Agents in pipeline order (position ASC). Each agent may carry
   * pre-resolved LLM credentials (`apiKey`, `apiKeyModel`) — the worker
   * looks these up from the `llm_credentials` table before invoking the
   * runtime, so this package stays decoupled from the DB.
   */
  agents: Array<
    Agent & {
      reads_from: 'all' | string[];
      apiKey?: string;
      apiKeyModel?: string;
    }
  >;
}

export interface PipelineRunResult {
  finding: Finding;
  agentRuns: AgentRunRecord[];
  shouldAlert: boolean;
  totals: { inputTokens: number; outputTokens: number };
  finalProvider: string;
  finalModel: string;
}
