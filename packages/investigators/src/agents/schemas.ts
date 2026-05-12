import { z } from 'zod';
import type { JSONSchema } from '@argus/ai-providers';
import { FINDING_RESPONSE_SCHEMA, FindingSchema } from '../types.js';
import type { OutputSchemaKind } from './types.js';

/**
 * Preset output schemas for agents. v0.2 ships a fixed set of three to keep
 * the dashboard form simple — see the locked design decisions in the plan.
 *
 *   text     — no responseSchema. Raw text out. Hypothesis / summarization.
 *   analysis — bounded intermediate JSON. Names of suspicious patterns + notes.
 *   finding  — the existing FINDING_RESPONSE_SCHEMA. Always last; produces the
 *              persisted `findings` row.
 */

export const AnalysisSchema = z.object({
  findings: z.array(z.string().min(1).max(500)).min(0).max(50),
  notes: z.string().max(2000).default(''),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

const ANALYSIS_RESPONSE_SCHEMA: JSONSchema = {
  type: 'object',
  required: ['findings', 'notes'],
  properties: {
    findings: {
      type: 'array',
      description: 'Short matched-pattern descriptions, each citing event_ids in parentheses.',
      items: { type: 'string' },
    },
    notes: {
      type: 'string',
      description: 'Free-form notes on confidence, caveats, or uncertainty.',
    },
  },
  additionalProperties: false,
};

export interface OutputKindSpec {
  /** JSONSchema to send to the provider. `null` means free-form text. */
  responseSchema: JSONSchema | null;
  /** Validate provider output. Throws on shape mismatch. */
  validate(parsed: unknown): unknown;
}

const TEXT_SPEC: OutputKindSpec = {
  responseSchema: null,
  validate: (parsed) => {
    // Text agents return a string in `text`, not in `parsedJson`. The runtime
    // skips this validate() for kind=text; included for symmetry.
    return parsed;
  },
};

const ANALYSIS_SPEC: OutputKindSpec = {
  responseSchema: ANALYSIS_RESPONSE_SCHEMA,
  validate: (parsed) => AnalysisSchema.parse(parsed),
};

const FINDING_SPEC: OutputKindSpec = {
  responseSchema: FINDING_RESPONSE_SCHEMA,
  // We can't fully validate here because `investigator_id` is injected by the
  // runtime, not emitted by the model. The runtime calls FindingSchema.parse
  // after merging that field — see agents/runtime.ts.
  validate: (parsed) => parsed,
};

export const OUTPUT_KIND_SPECS: Record<OutputSchemaKind, OutputKindSpec> = {
  text: TEXT_SPEC,
  analysis: ANALYSIS_SPEC,
  finding: FINDING_SPEC,
};

export { FindingSchema };
