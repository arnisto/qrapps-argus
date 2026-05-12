import type { Agent, HealthSnapshot } from '@/lib/api';
import { Chip, AgentBadge } from './Chip';

interface Props {
  /** Up to ~3 agents shown on the left. Order: most recently active first. */
  agents: Agent[];
  /** Used for the right-side totals — events / findings. */
  health: HealthSnapshot | null;
}

const TONES = ['blue', 'rose', 'amber', 'emerald'] as const;

/**
 * The live "Argus Pulse" band that sits under the top bar. Shows the agents
 * online, a tiny event stream of recent findings, and 24h totals on the right.
 * Real data: agents from /v1/agents, totals from /v1/health/snapshot. The
 * "live stream" rows reuse the most recent findings/failures the health
 * snapshot already aggregated.
 */
export function PulseBand({ agents, health }: Props) {
  const onlineAgents = agents.slice(0, 3);
  const eventsToday = health?.activity.events_24h ?? '—';
  const findingsToday = health?.activity.findings_24h ?? '—';
  const recent = health?.recent_failures.slice(0, 2) ?? [];

  return (
    <div
      className="grid gap-4 items-center"
      style={{
        gridTemplateColumns: '1.3fr 1.7fr 1fr',
        padding: '10px 18px',
        borderBottom: '1px solid var(--line)',
        background:
          'linear-gradient(180deg, color-mix(in oklch, var(--bg-1) 92%, transparent), color-mix(in oklch, var(--bg-0) 88%, transparent))',
      }}
    >
      {/* ---- left: agents online ---- */}
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--blue)' }}>
            <span className="live-dot" />
          </span>
          <span className="uppercase-mini text-fg-2">Argus pulse</span>
          <Chip tone="blue" size="sm">
            {agents.length} agents online
          </Chip>
        </div>
        <div className="flex flex-wrap gap-3" style={{ fontSize: 11.5 }}>
          {onlineAgents.map((a, i) => (
            <span key={a.id} className="flex items-center gap-2">
              <AgentBadge tone={TONES[i % TONES.length]} size={18}>
                {initials(a.name)}
              </AgentBadge>
              <span className="truncate">
                {a.name}{' '}
                <span className="mono text-fg-3" style={{ fontSize: 10.5 }}>
                  {kindLabel(a.output_schema_kind)}
                </span>
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* ---- middle: live stream ---- */}
      <div className="flex flex-col gap-1 min-w-0">
        <span className="uppercase-mini text-fg-2">Live stream</span>
        {recent.length === 0 ? (
          <div
            className="flex items-center gap-2 truncate"
            style={{ fontSize: 12, opacity: 0.7 }}
          >
            <Chip tone="emerald" size="sm">
              quiet
            </Chip>
            <span>No anomalies in last 24h — Argus is watching.</span>
          </div>
        ) : (
          recent.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-2 truncate"
              style={{ fontSize: 12, opacity: i === 0 ? 1 : 0.7 }}
            >
              <Chip tone={i === 0 ? 'rose' : 'amber'} size="sm">
                {i === 0 ? 'anomaly' : 'watch'}
              </Chip>
              <span className="truncate">
                <span className="text-fg-1">{r.investigator_id}</span>{' '}
                <span className="text-fg-3">
                  flagged <span className="mono">{(r.error || '').slice(0, 50)}</span>
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      {/* ---- right: totals ---- */}
      <div className="flex flex-col items-end gap-1">
        <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
          {Number(eventsToday).toLocaleString()}{' '}
          <span className="text-fg-3" style={{ fontSize: 10, fontWeight: 400 }}>
            events / 24h
          </span>
        </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--emerald)' }}>
          +{findingsToday} findings today
        </span>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function kindLabel(kind: 'text' | 'analysis' | 'finding'): string {
  switch (kind) {
    case 'text':
      return 'watching…';
    case 'analysis':
      return 'reasoning…';
    case 'finding':
      return 'writing…';
  }
}
