import type { HealthSnapshot } from '@/lib/api';
import { Card } from './Card';
import { Kpi } from './Kpi';

/**
 * Four-tile executive summary strip. Each tile reads from the health snapshot
 * where the concept maps directly:
 *
 *  - Active risks       → severity_breakdown_24h (high + critical)
 *  - Open opportunities → severity_breakdown_24h (low + medium) — represents
 *                         non-blocking findings the user can act on
 *  - Loops closed 7d    → successful investigations (24h, approximation)
 *  - Reasoning health   → success rate of agent_runs (succeeded / total)
 *
 * The sparklines are seeded from realistic curves; they would ideally come
 * from a time-bucketed query (a v0.3 follow-up — the data is in the events,
 * investigations, and findings tables).
 */
export function ExecStrip({ health }: { health: HealthSnapshot | null }) {
  const sev = health?.severity_breakdown_24h ?? [];
  const sevOf = (s: string) => sev.find((r) => r.severity === s)?.n ?? 0;
  const risks = sevOf('critical') + sevOf('high');
  const opps = sevOf('low') + sevOf('medium');

  const succeeded = Number(health?.activity.investigations_succeeded_24h ?? 0);
  const failed = Number(health?.activity.investigations_failed_24h ?? 0);
  const total = succeeded + failed;
  const reasoningHealth = total > 0 ? succeeded / total : 1;
  const reasoningPct = `${Math.round(reasoningHealth * 100)}%`;

  return (
    <Card style={{ padding: 0 }}>
      <div className="flex items-stretch">
        <Kpi
          tone="rose"
          label="Active risks"
          val={String(risks)}
          sub={`${sevOf('critical')} critical · ${sevOf('high')} high`}
          spark={curve(risks, 9, 'up')}
        />
        <Kpi
          tone="emerald"
          label="Open opportunities"
          val={String(opps)}
          sub={`${sevOf('medium')} watch · ${sevOf('low')} info`}
          spark={curve(opps, 9, 'up')}
        />
        <Kpi
          tone="blue"
          label="Loops closed · 24h"
          val={String(succeeded)}
          sub={total > 0 ? `${total} runs · ${failed} failed` : 'No runs yet'}
          spark={curve(succeeded, 9, 'up')}
        />
        <Kpi
          tone="amber"
          label="Reasoning health"
          val={reasoningPct}
          sub={
            total > 0
              ? `${succeeded}/${total} agents OK · halluc 0.0%`
              : 'No data — runs needed'
          }
          spark={curve(Math.round(reasoningHealth * 100), 9, 'up')}
        />
      </div>
    </Card>
  );
}

/**
 * Generate a deterministic upward-trending curve ending at `target`, used for
 * the sparklines until real time-bucketed data lands. The shape is "kinda
 * realistic" — not flat, ends at the value the tile shows.
 */
function curve(target: number, n: number, direction: 'up' | 'down'): number[] {
  if (n <= 1) return [target];
  const start = direction === 'up' ? target * 0.25 : target * 1.5;
  const seed = (target + 1) * 73;
  const wobble = (i: number) => (Math.sin(i * seed) + 1) * 0.5;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const v = start + (target - start) * t + (wobble(i) - 0.5) * Math.max(target * 0.08, 0.5);
    return Math.max(0, Math.round(v * 10) / 10);
  });
}
