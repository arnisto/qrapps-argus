import { z } from 'zod';
import { SeveritySchema } from '@argus/shared';
import type { JSONSchema } from '@argus/ai-providers';

export const FindingSchema = z.object({
  investigator_id: z.string(),
  severity: SeveritySchema,
  summary: z.string().min(1).max(2000),
  evidence: z
    .array(
      z.object({
        event_id: z.string().min(1),
        reason: z.string().min(1).max(500),
      }),
    )
    .min(0),
  recommendation: z.string().max(2000).optional(),
  impact_estimate: z
    .object({
      currency: z.string().min(3).max(3),
      amount: z.number(),
      basis: z.string().min(1).max(500),
    })
    .optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

/** JSON Schema describing a Finding — handed to AI providers. */
export const FINDING_RESPONSE_SCHEMA: JSONSchema = {
  type: 'object',
  required: ['severity', 'summary', 'evidence'],
  properties: {
    severity: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
    summary: { type: 'string', description: 'One-paragraph executive summary.' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        required: ['event_id', 'reason'],
        properties: {
          event_id: { type: 'string' },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    recommendation: { type: 'string' },
    impact_estimate: {
      type: 'object',
      required: ['currency', 'amount', 'basis'],
      properties: {
        currency: { type: 'string' },
        amount: { type: 'number' },
        basis: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};
