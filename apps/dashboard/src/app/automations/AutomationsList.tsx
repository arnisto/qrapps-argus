'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AutomationRow } from '@/lib/automations-server';
import { CreateDrawer } from './CreateDrawer';

type Filter = 'all' | 'failing' | 'paused';

interface FleetStats {
  active: number;
  failing: number;
  suppressed: number;
  nextRun: string | null;
}

function computeStats(rows: AutomationRow[]): FleetStats {
  let active = 0;
  let failing = 0;
  let suppressed = 0;
  let nextRunMs = Infinity;
  for (const r of rows) {
    if (r.status === 'active') active += 1;
    if (r.last_run_status === 'failed') failing += 1;
    if (r.last_run_status === 'suppressed') suppressed += 1;
    if (r.next_run_at) {
      const ms = new Date(r.next_run_at).getTime();
      if (ms < nextRunMs) nextRunMs = ms;
    }
  }
  return {
    active,
    failing,
    suppressed,
    nextRun: nextRunMs === Infinity ? null : new Date(nextRunMs).toISOString(),
  };
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  if (abs < 60_000) return ms < 0 ? 'just now' : 'in <1m';
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return ms < 0 ? `${mins}m ago` : `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return ms < 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return ms < 0 ? `${days}d ago` : `in ${days}d`;
}

function railToneFor(row: AutomationRow): string {
  if (row.status === 'paused' || row.status === 'disabled') return 'bg-border';
  if (row.last_run_status === 'failed') return 'bg-red';
  if (row.last_run_status === 'suppressed') return 'bg-amber';
  if (row.status === 'active') return 'bg-green';
  return 'bg-border';
}

export function AutomationsList({
  envSlug,
  initialRows,
}: {
  envSlug: string;
  initialRows: AutomationRow[];
}) {
  const router = useRouter();
  const [rows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const stats = useMemo(() => computeStats(rows), [rows]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'failing' && r.last_run_status !== 'failed') return false;
      if (filter === 'paused' && r.status !== 'paused') return false;
      if (term && !(r.name + ' ' + r.prompt_text).toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, filter, q]);

  return (
    <div className="space-y-6">
      {/* fleet tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <FleetTile label="Active" value={String(stats.active)} />
        <FleetTile
          label="Failed today"
          value={String(stats.failing)}
          dot={stats.failing > 0}
          tone={stats.failing > 0 ? 'red' : 'neutral'}
          active={filter === 'failing'}
          onClick={() => setFilter(filter === 'failing' ? 'all' : 'failing')}
        />
        <FleetTile label="Suppressed (cost)" value={String(stats.suppressed)} />
        <FleetTile label="Next run" value={relTime(stats.nextRun)} />
      </div>

      {/* search + filters + new */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search automations…"
          className="flex-1 min-w-[220px] rounded-md bg-surface-2 border border-border px-3 py-2 text-sm text-text outline-none placeholder:text-text-3 focus:border-accent focus:shadow-focus transition"
        />
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-inset p-0.5">
          {(['all', 'failing', 'paused'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={[
                'px-2.5 py-1 rounded-md text-xs font-semibold transition outline-none capitalize',
                filter === f
                  ? 'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-text'
                  : 'text-text-3 hover:text-text-2',
              ].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-md bg-accent text-white text-sm font-semibold px-3 py-2 hover:opacity-90 transition"
        >
          + New
        </button>
      </div>

      {/* list */}
      {visible.length === 0 ? (
        <EmptyState onCreate={() => setDrawerOpen(true)} hasAny={rows.length > 0} />
      ) : (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
          {visible.map((r, i) => (
            <RowItem key={r.id} row={r} envSlug={envSlug} divider={i > 0} />
          ))}
        </div>
      )}

      {drawerOpen ? (
        <CreateDrawer
          envSlug={envSlug}
          onClose={() => setDrawerOpen(false)}
          onCreated={() => {
            setDrawerOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function FleetTile({
  label,
  value,
  dot,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  dot?: boolean;
  tone?: 'red' | 'neutral';
  active?: boolean;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className={[
        'rounded-2xl border bg-surface px-4 py-3 text-left transition',
        clickable ? 'hover:bg-surface-2 cursor-pointer' : 'cursor-default',
        active ? 'border-red shadow-[0_0_0_2px_var(--red-soft)]' : 'border-border',
      ].join(' ')}
    >
      <div className="text-2xs font-semibold uppercase tracking-wider text-text-3">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-text font-mono">{value}</span>
        {dot ? (
          <span className={`w-2 h-2 rounded-full ${tone === 'red' ? 'bg-red' : 'bg-amber'}`} />
        ) : null}
      </div>
    </button>
  );
}

function RowItem({
  row,
  envSlug,
  divider,
}: {
  row: AutomationRow;
  envSlug: string;
  divider: boolean;
}) {
  const tone = railToneFor(row);
  const connectorSummary = useMemo(() => {
    const p = row.compiled_plan as Record<string, Record<string, string>>;
    if (!p.read?.connector_subtype) return '— · not compiled';
    const inn = `${p.read.connector_subtype}`;
    const out = p.send?.connector_subtype
      ? `${p.send.connector_subtype}${p.send.channel ? '/' + p.send.channel : ''}`
      : '?';
    return `${inn} → ${out}`;
  }, [row.compiled_plan]);

  return (
    <a
      href={`/automations/${row.id}?env=${envSlug}`}
      className={[
        'flex relative group hover:bg-surface-2 transition',
        divider ? 'border-t border-border' : '',
      ].join(' ')}
    >
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${tone}`} />
      <div className="flex-1 pl-4 pr-3 py-3 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-text truncate">{row.name}</h3>
          <span className="text-2xs font-mono text-text-3 whitespace-nowrap">
            next: {row.next_run_at ? relTime(row.next_run_at) : '—'}
            {row.schedule_tz !== 'UTC' ? ` (${row.schedule_tz.split('/').pop()})` : ''}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3 text-2xs text-text-3 font-mono">
          <span className="truncate">
            {row.schedule_cron ?? 'no schedule'} · {connectorSummary}
          </span>
          <span className="whitespace-nowrap">
            last:{' '}
            <span
              className={
                row.last_run_status === 'failed'
                  ? 'text-red font-semibold'
                  : row.last_run_status === 'ok'
                    ? 'text-green'
                    : ''
              }
            >
              {row.last_run_status ?? 'never'}
            </span>
            {row.last_run_started_at ? ` · ${relTime(row.last_run_started_at)}` : ''}
          </span>
        </div>
      </div>
    </a>
  );
}

function EmptyState({
  onCreate,
  hasAny,
}: {
  onCreate: () => void;
  hasAny: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-10 text-center">
      <div className="text-text font-semibold mb-1">
        {hasAny ? 'No automations match this filter' : 'No automations yet'}
      </div>
      <div className="text-sm text-text-2 max-w-md mx-auto mb-5 leading-snug">
        {hasAny
          ? 'Try a different filter, or clear the search.'
          : 'Tell Argus what to do and when. It will preview once before going live, then run on schedule.'}
      </div>
      {!hasAny ? (
        <button
          type="button"
          onClick={onCreate}
          className="rounded-md bg-accent text-white text-sm font-semibold px-3 py-2 hover:opacity-90 transition"
        >
          + Create your first automation
        </button>
      ) : null}
    </div>
  );
}
