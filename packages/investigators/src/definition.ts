import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { SeveritySchema } from '@argus/shared';

export const InvestigatorDefinitionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'investigator id must be lowercase-kebab'),
  name: z.string().min(1),
  description: z.string().min(1),

  triggers: z.object({
    events: z.array(z.string()).default([]),
    schedule: z.string().optional(), // cron expression
  }),

  context: z.object({
    lookback: z
      .string()
      .regex(/^\d+(s|m|h|d)$/, 'lookback must be like "24h", "30m", "7d"'),
    related_events: z.array(z.string()).default([]),
    max_events: z.number().int().positive().max(2000).default(500),
  }),

  // Required in v1 definitions; v2 (pipeline) definitions store agents in
  // pipeline_agents instead. The worker only reaches code paths that read
  // `checks` when the legacy single-call branch runs.
  checks: z.array(z.string().min(1)).min(1).optional(),

  severity_threshold: SeveritySchema.default('medium'),
  provider: z.enum(['claude', 'openai', 'gemini', 'ollama', 'deepseek', 'mock']).optional(),
  model: z.string().optional(),

  output: z
    .object({
      alert_channels: z.array(z.string()).default([]),
    })
    .default({ alert_channels: [] }),
});

export type InvestigatorDefinition = z.infer<typeof InvestigatorDefinitionSchema>;

export function loadInvestigatorFromYaml(path: string): InvestigatorDefinition {
  const raw = readFileSync(path, 'utf8');
  return InvestigatorDefinitionSchema.parse(parseYaml(raw));
}

export function parseInvestigator(unknown: unknown): InvestigatorDefinition {
  return InvestigatorDefinitionSchema.parse(unknown);
}

/** Convert a lookback string ("24h", "30m") to milliseconds. */
export function lookbackToMs(lookback: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(lookback);
  if (!match) throw new Error(`invalid lookback: ${lookback}`);
  const n = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's':
      return n * 1_000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    default:
      throw new Error(`unreachable lookback unit: ${unit}`);
  }
}
