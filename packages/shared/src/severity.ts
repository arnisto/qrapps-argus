import { z } from 'zod';

export const SeveritySchema = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

const ORDER: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** True iff `actual` is at least as severe as `threshold`. */
export function meetsThreshold(actual: Severity, threshold: Severity): boolean {
  return ORDER[actual] >= ORDER[threshold];
}
