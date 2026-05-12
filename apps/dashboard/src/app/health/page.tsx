import { api, type HealthSnapshot } from '@/lib/api';
import { AutoRefresh } from '@/components/ds/AutoRefresh';

export const dynamic = 'force-dynamic';

const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-950 text-red-300 border-red-900',
  high: 'bg-orange-950 text-orange-300 border-orange-900',
  medium: 'bg-amber-950 text-amber-300 border-amber-900',
  low: 'bg-sky-950 text-sky-300 border-sky-900',
  none: 'bg-slate-800 text-slate-400 border-slate-700',
};

export default async function HealthPage() {
  let snapshot: HealthSnapshot | null = null;
  let error: string | null = null;
  try {
    snapshot = await api<HealthSnapshot>('/v1/health/snapshot');
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="px-4 py-6">
      {/*
        Soft auto-refresh — re-fetches server components every 10s without
        reloading the whole page. The earlier `<meta httpEquiv="refresh">`
        approach caused a full nav reload that blinked the entire UI and
        looked, justifiably, like Argus was "stuck refreshing".
       */}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System health</h1>
          <p className="mt-1 text-sm text-argus-muted">
            Live snapshot{' '}
            {snapshot && (
              <span>· generated {new Date(snapshot.generated_at).toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <AutoRefresh intervalSeconds={10} />
      </div>

      {error || !snapshot ? (
        <div className="rounded border border-argus-danger/40 bg-argus-panel p-4 text-sm text-argus-danger">
          {error ?? 'No snapshot data'}
        </div>
      ) : (
        <div className="space-y-6">
          <ActivityRow activity={snapshot.activity} backlog={snapshot.alerts_backlog} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SeverityCard breakdown={snapshot.severity_breakdown_24h} />
            <QueuesCard queues={snapshot.queues} />
            <CurrentlyRunningCard rows={snapshot.currently_running} />
            <RepetitiveCard rows={snapshot.repetitive_findings} />
            <TopFailingInvestigatorsCard rows={snapshot.top_failing_investigators} />
            <TopFailingAgentsCard rows={snapshot.top_failing_agents} />
            <RecentFailuresCard rows={snapshot.recent_failures} />
            <ConnectorsCard rows={snapshot.connectors} />
          </div>
          <ChannelsCard rows={snapshot.channels} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function ActivityRow({
  activity,
  backlog,
}: {
  activity: HealthSnapshot['activity'];
  backlog: HealthSnapshot['alerts_backlog'];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Events 24h" value={activity.events_24h} />
      <Stat label="Investigations 24h" value={activity.investigations_24h} />
      <Stat
        label="Succeeded 24h"
        value={activity.investigations_succeeded_24h}
        tone="ok"
      />
      <Stat
        label="Failed 24h"
        value={activity.investigations_failed_24h}
        tone={Number(activity.investigations_failed_24h) > 0 ? 'danger' : 'muted'}
      />
      <Stat label="Findings 24h" value={activity.findings_24h} />
      <Stat
        label="Alerts pending"
        value={String(backlog.pending)}
        sub={
          backlog.oldest_pending_age_s
            ? `oldest: ${Math.round(backlog.oldest_pending_age_s)}s`
            : undefined
        }
        tone={backlog.pending > 0 ? 'warn' : 'muted'}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'muted';
}) {
  const toneClass = {
    default: 'text-slate-100',
    ok: 'text-argus-ok',
    warn: 'text-argus-warn',
    danger: 'text-argus-danger',
    muted: 'text-argus-muted',
  }[tone];
  return (
    <div className="rounded border border-argus-border bg-argus-panel p-3">
      <div className="text-[10px] uppercase tracking-wide text-argus-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-argus-muted">{sub}</div>}
    </div>
  );
}

function Card({ title, children, empty }: { title: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <section className="rounded border border-argus-border bg-argus-panel p-4">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-argus-muted">{title}</h2>
      {empty ? (
        <p className="text-xs text-argus-muted">Nothing to show.</p>
      ) : (
        children
      )}
    </section>
  );
}

function SeverityCard({ breakdown }: { breakdown: HealthSnapshot['severity_breakdown_24h'] }) {
  const total = breakdown.reduce((s, r) => s + r.n, 0);
  return (
    <Card title="Findings by severity (24h)" empty={total === 0}>
      <ul className="space-y-2">
        {breakdown.map((row) => {
          const pct = total > 0 ? Math.round((row.n / total) * 100) : 0;
          return (
            <li key={row.severity}>
              <div className="flex items-center justify-between text-xs">
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono uppercase ${SEV_COLORS[row.severity] ?? SEV_COLORS.none}`}
                >
                  {row.severity}
                </span>
                <span className="font-mono text-slate-300">
                  {row.n} <span className="text-argus-muted">({pct}%)</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-argus-bg">
                <div
                  className={`h-full ${pct >= 50 ? 'bg-argus-danger' : pct >= 20 ? 'bg-argus-warn' : 'bg-argus-accent'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function QueuesCard({ queues }: { queues: HealthSnapshot['queues'] }) {
  const entries = Object.entries(queues);
  return (
    <Card title="BullMQ queues" empty={entries.length === 0}>
      <table className="w-full text-xs">
        <thead className="text-argus-muted">
          <tr className="text-left">
            <th className="py-1">queue</th>
            <th className="py-1 text-right">wait</th>
            <th className="py-1 text-right">active</th>
            <th className="py-1 text-right">failed</th>
            <th className="py-1 text-right">done</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {entries.map(([name, c]) => (
            <tr key={name} className="border-t border-argus-border/60">
              <td className="py-1 text-slate-300">{name}</td>
              <td
                className={`py-1 text-right ${c.waiting > 0 ? 'text-argus-warn' : 'text-argus-muted'}`}
              >
                {c.waiting}
              </td>
              <td className="py-1 text-right text-slate-300">{c.active}</td>
              <td
                className={`py-1 text-right ${c.failed > 0 ? 'text-argus-danger' : 'text-argus-muted'}`}
              >
                {c.failed}
              </td>
              <td className="py-1 text-right text-argus-muted">{c.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function CurrentlyRunningCard({ rows }: { rows: HealthSnapshot['currently_running'] }) {
  return (
    <Card title={`Running now (${rows.length})`} empty={rows.length === 0}>
      <ul className="space-y-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between">
            <span className="font-mono text-slate-300">{r.investigator_id}</span>
            <span
              className={`font-mono ${
                r.age_s > 60 ? 'text-argus-warn' : 'text-argus-muted'
              }`}
            >
              {r.age_s}s
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RepetitiveCard({ rows }: { rows: HealthSnapshot['repetitive_findings'] }) {
  return (
    <Card title="Repetitive findings (6h)" empty={rows.length === 0}>
      <ul className="space-y-2 text-xs">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-slate-300">{r.investigator_id}</div>
              <p className="truncate text-argus-muted">{r.summary_prefix}…</p>
            </div>
            <span className="shrink-0 rounded border border-argus-warn/40 bg-argus-warn/5 px-2 py-0.5 font-mono text-argus-warn">
              ×{r.occurrences}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TopFailingInvestigatorsCard({
  rows,
}: {
  rows: HealthSnapshot['top_failing_investigators'];
}) {
  return (
    <Card title="Top failing investigators (24h)" empty={rows.length === 0}>
      <ul className="space-y-2 text-xs">
        {rows.map((r) => (
          <li key={r.investigator_id} className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-slate-100">{r.name ?? r.investigator_id}</div>
              <div className="font-mono text-argus-muted">{r.investigator_id}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-argus-danger">{r.fails} / {r.runs}</div>
              <div className="text-argus-muted">{r.fail_rate}% fail</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TopFailingAgentsCard({ rows }: { rows: HealthSnapshot['top_failing_agents'] }) {
  return (
    <Card title="Top failing agents (24h)" empty={rows.length === 0}>
      <ul className="space-y-2 text-xs">
        {rows.map((r) => (
          <li key={r.agent_id}>
            <div className="flex items-center justify-between">
              <span className="text-slate-100">{r.agent_name ?? r.agent_id}</span>
              <span className="font-mono text-argus-danger">×{r.fails}</span>
            </div>
            {r.last_error && (
              <pre className="mt-1 truncate font-mono text-[10px] text-argus-muted">
                {r.last_error}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RecentFailuresCard({ rows }: { rows: HealthSnapshot['recent_failures'] }) {
  return (
    <Card title="Recent failures" empty={rows.length === 0}>
      <ul className="space-y-2 text-xs">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-slate-300">{r.investigator_id}</span>
              <span className="text-argus-muted">{new Date(r.started_at).toLocaleTimeString()}</span>
            </div>
            <p className="truncate text-argus-danger">{r.error}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ConnectorsCard({ rows }: { rows: HealthSnapshot['connectors'] }) {
  return (
    <Card title="Connector status" empty={rows.length === 0}>
      <ul className="space-y-2 text-xs">
        {rows.map((c) => {
          const testColor =
            c.last_test_ok === true
              ? 'text-argus-ok'
              : c.last_test_ok === false
                ? 'text-argus-danger'
                : 'text-argus-muted';
          return (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-100">{c.name}</span>
                  <span className="rounded border border-argus-border px-1 py-0.5 font-mono text-[10px] text-argus-muted">
                    {c.type}
                  </span>
                  {c.last_test_at && (
                    <span
                      className={`rounded border px-1 py-0.5 font-mono text-[10px] ${
                        c.last_test_ok
                          ? 'border-emerald/40 text-argus-ok bg-emerald/10'
                          : 'border-rose/40 text-argus-danger bg-rose/10'
                      }`}
                    >
                      {c.last_test_ok ? '✓ test ok' : '✗ test failed'}
                    </span>
                  )}
                </div>
                {c.last_error ? (
                  <p className="mt-1 truncate text-argus-danger">sync: {c.last_error}</p>
                ) : (
                  <p className="mt-1 text-argus-muted">
                    {c.last_sync_at
                      ? `synced ${new Date(c.last_sync_at).toLocaleTimeString()}`
                      : 'never synced'}
                  </p>
                )}
                {!c.last_test_ok && c.last_test_error && (
                  <p className={`mt-1 truncate font-mono ${testColor}`}>
                    test: {c.last_test_error}
                  </p>
                )}
              </div>
              <span className={c.enabled ? 'text-argus-ok' : 'text-argus-muted'}>
                {c.enabled ? '●' : '○'}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ChannelsCard({ rows }: { rows: HealthSnapshot['channels'] }) {
  return (
    <Card title="Alert channels (24h)" empty={rows.length === 0}>
      <table className="w-full text-xs">
        <thead className="text-argus-muted">
          <tr className="text-left">
            <th className="py-1">channel</th>
            <th className="py-1">type</th>
            <th className="py-1">min sev</th>
            <th className="py-1 text-right">sent</th>
            <th className="py-1 text-right">failed</th>
            <th className="py-1 text-right">status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.channel_id} className="border-t border-argus-border/60">
              <td className="py-1 text-slate-100">{c.name}</td>
              <td className="py-1 font-mono text-argus-muted">{c.type}</td>
              <td className="py-1 font-mono text-argus-muted">{c.min_severity ?? 'low'}</td>
              <td className="py-1 text-right font-mono text-argus-ok">{c.sent_24h}</td>
              <td
                className={`py-1 text-right font-mono ${c.failed_24h > 0 ? 'text-argus-danger' : 'text-argus-muted'}`}
              >
                {c.failed_24h}
              </td>
              <td className="py-1 text-right">
                <span className={c.enabled ? 'text-argus-ok' : 'text-argus-muted'}>
                  {c.enabled ? '●' : '○'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
