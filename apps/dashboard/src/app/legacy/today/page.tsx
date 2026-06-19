import { api, type Agent, type Finding, type HealthSnapshot, type Investigator } from '@/lib/api';
import { PulseBand } from '@/components/ds/PulseBand';
import { ExecStrip } from '@/components/ds/ExecStrip';
import { SideRail } from '@/components/ds/SideRail';
import { IntelligenceFeed } from '@/components/ds/IntelligenceFeed';
import { MemoryGraphMini } from '@/components/ds/MemoryGraphMini';
import { Card, CardHeader } from '@/components/ds/Card';
import { Chip } from '@/components/ds/Chip';

export const dynamic = 'force-dynamic';

/**
 * Today — the canonical entry point. Mirrors Screen 1 of the Argus Flow design.
 *
 * Layout: 200px side rail · main column · 280px right rail.
 * Data: health snapshot, 4 most-recent findings, all agents (pulse band),
 * all investigators (side rail).
 *
 * Opportunity Hunter + Operational Memory metrics are representative for
 * v0.2 — backing pipelines for them ship in v0.3.
 */
export default async function TodayPage() {
  const [health, findings, agents, investigators] = await Promise.all([
    safeApi<HealthSnapshot>('/v1/health/snapshot'),
    safeApi<{ findings: Finding[] }>('/v1/findings?limit=4').then((r) => r?.findings ?? []),
    safeApi<{ agents: Agent[] }>('/v1/agents').then((r) => r?.agents ?? []),
    safeApi<{ investigators: Investigator[] }>('/v1/investigators').then(
      (r) => r?.investigators ?? [],
    ),
  ]);

  return (
    <>
      <PulseBand agents={agents} health={health} />
      <div
        className="grid"
        style={{
          gridTemplateColumns: '200px 1fr 280px',
          gap: 16,
          padding: 16,
          minHeight: 0,
        }}
      >
        <SideRail active="Pulse" health={health} investigators={investigators} />

        <div className="flex flex-col gap-3 min-w-0">
          <GreetingRow />
          <ExecStrip health={health} />
          <IntelligenceFeed findings={findings} />
        </div>

        <div className="flex flex-col gap-3">
          <OpportunityHunter />
          <OperationalMemoryCard />
        </div>
      </div>
    </>
  );
}

function GreetingRow() {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 5
      ? 'Good night'
      : hour < 12
        ? 'Good morning'
        : hour < 18
          ? 'Good afternoon'
          : 'Good evening';
  const dateLine = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col">
        <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {greeting} —{' '}
          <span className="text-fg-2" style={{ fontWeight: 400 }}>
            here&apos;s what Argus thinks matters today.
          </span>
        </span>
        <span className="mono text-fg-3" style={{ fontSize: 11 }}>
          {dateLine} · executive summary first, full reasoning one click below.
        </span>
      </div>
    </div>
  );
}

function OpportunityHunter() {
  const rows = [
    { v: '5.2%', u: 'cost ↓', label: 'Consolidate routes via Hub-7', area: 'Logistics' },
    { v: '$98k', u: 'rev ↑', label: 'Pantry cross-sell window', area: 'Revenue' },
    { v: '3.1d', u: 'cycle ↓', label: 'Renegotiate vendor #PKG-220', area: 'Procurement' },
    { v: '11%', u: 'churn ↓', label: 'Re-engage Tier-2 dormant cohort', area: 'Growth' },
  ];
  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">Opportunity Hunter</span>
        <span className="mono text-fg-3 ml-auto" style={{ fontSize: 11 }}>
          {rows.length} fresh
        </span>
      </CardHeader>
      <div>
        {rows.map((r, i) => (
          <div
            key={r.label}
            className="grid items-center"
            style={{
              gridTemplateColumns: 'auto 1fr auto',
              gap: 10,
              padding: '10px 12px',
              borderTop: i === 0 ? 0 : '1px solid var(--line)',
            }}
          >
            <div className="flex flex-col">
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--emerald)',
                  letterSpacing: '-0.01em',
                  lineHeight: 1,
                }}
              >
                {r.v}
                <span className="text-fg-3" style={{ fontSize: 11, marginLeft: 2 }}>
                  {' '}
                  {r.u}
                </span>
              </span>
              <span className="mono text-fg-3" style={{ fontSize: 10.5 }}>
                {r.area}
              </span>
            </div>
            <div className="truncate" style={{ fontSize: 12 }}>
              {r.label}
            </div>
            <span className="mono text-fg-3" style={{ fontSize: 11 }}>
              ›
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function OperationalMemoryCard() {
  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">Operational Memory</span>
        <Chip tone="blue" size="sm" className="ml-auto">
          v12
        </Chip>
      </CardHeader>
      <MemoryGraphMini />
      <div className="flex items-center gap-3" style={{ padding: 12 }}>
        <div className="flex flex-col gap-1">
          <span className="uppercase-mini text-fg-3">Recall</span>
          <span className="mono font-semibold">89%</span>
        </div>
        <span style={{ width: 1, height: 24, background: 'var(--line)' }} />
        <div className="flex flex-col gap-1">
          <span className="uppercase-mini text-fg-3">Halluc</span>
          <span className="mono font-semibold">0.6%</span>
        </div>
        <span style={{ width: 1, height: 24, background: 'var(--line)' }} />
        <div className="flex flex-col gap-1">
          <span className="uppercase-mini text-fg-3">Hops</span>
          <span className="mono font-semibold">4.2</span>
        </div>
      </div>
    </Card>
  );
}

async function safeApi<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch {
    return null;
  }
}
