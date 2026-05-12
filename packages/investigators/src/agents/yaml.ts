import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { AgentSchema, InvestigatorV2Schema, type Agent, type InvestigatorV2 } from './types.js';

/** Loader for builtin agent YAMLs in packages/investigators/templates/agents/. */
const AgentYamlSchema = AgentSchema.extend({
  // Builtins specify source explicitly; user agents default to 'user' via the
  // API. We accept both shapes here.
  source: z.enum(['builtin', 'user']).default('builtin'),
});

export function loadAgentFromYaml(path: string): Agent {
  const raw = readFileSync(path, 'utf8');
  return AgentYamlSchema.parse(parseYaml(raw));
}

/** Loader for v2 pipeline YAMLs in packages/investigators/templates/. */
export function loadInvestigatorV2FromYaml(path: string): InvestigatorV2 {
  const raw = readFileSync(path, 'utf8');
  return InvestigatorV2Schema.parse(parseYaml(raw));
}
