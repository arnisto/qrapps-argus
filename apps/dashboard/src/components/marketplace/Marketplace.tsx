'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CatalogEntry, ConnectedRow, ConnectorKind } from '@/lib/connectors-server';
import { ConnectDrawer } from './ConnectDrawer';
import { ConnectedCard } from './ConnectedCard';

/**
 * The shared marketplace surface. Used by both:
 *   · /connectors  → kinds: db, doc, tool   ("knowledge sources")
 *   · /channels    → kinds: channel         ("communication surfaces")
 *
 * The component is identical; the caller pre-filters the catalog by kind
 * and supplies category-appropriate copy + filter chips.
 */
export interface MarketplaceProps {
  envSlug: string;
  catalog: CatalogEntry[];
  connected: ConnectedRow[];
  /** Filter chips shown above the grid. Pass the kind chips appropriate
   *  to the category (e.g. for /connectors: All/Databases/Doc sync/Agent tools;
   *  for /channels: All/Inbound/Outbound). */
  kindFilters: Array<{ value: 'all' | string; label: string; matches: (e: CatalogEntry) => boolean }>;
  /** Optional per-card action surfaces (e.g. "Send test message" on a Slack
   *  connected card). Maps subtype → array of {label, handler}. */
  cardActions?: Record<string, Array<{ label: string; tone?: 'primary' | 'secondary'; onAct: (row: ConnectedRow) => Promise<void> | void }>>;
  /** Placeholder for the search box. */
  searchPlaceholder: string;
  /** Headline shown above the "Connected" block. */
  connectedHeadline?: string;
}

export function Marketplace({
  envSlug,
  catalog,
  connected,
  kindFilters,
  cardActions,
  searchPlaceholder,
  connectedHeadline = 'Connected',
}: MarketplaceProps) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [filterValue, setFilterValue] = useState<'all' | string>('all');
  const [openSubtype, setOpenSubtype] = useState<string | null>(null);

  const connectedBySubtype = useMemo(() => {
    const m = new Map<string, ConnectedRow[]>();
    for (const c of connected) {
      const arr = m.get(c.subtype) ?? [];
      arr.push(c);
      m.set(c.subtype, arr);
    }
    return m;
  }, [connected]);

  const active = kindFilters.find((f) => f.value === filterValue) ?? kindFilters[0]!;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return catalog
      .filter(active.matches)
      .filter((c) =>
        !term
          ? true
          : (c.name + ' ' + c.tagline + ' ' + c.tags.join(' ') + ' ' + c.subtype)
              .toLowerCase()
              .includes(term),
      );
  }, [catalog, active, q]);

  const openEntry = openSubtype ? catalog.find((c) => c.subtype === openSubtype) ?? null : null;

  async function onRemove(id: string, name: string) {
    if (!confirm(`Remove ${name}? Any knowledge it indexed will be deleted.`)) return;
    await fetch(`/be/envs/${encodeURIComponent(envSlug)}/env-connectors/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* connected section */}
      {connected.length > 0 ? (
        <section>
          <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-2 mb-3">
            {connectedHeadline} ({connected.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connected.map((c) => (
              <ConnectedCard
                key={c.id}
                row={c}
                entry={catalog.find((e) => e.subtype === c.subtype)}
                actions={cardActions?.[c.subtype]}
                onRemove={() => onRemove(c.id, c.name)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* search + filter */}
      <section>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 min-w-[220px] rounded-md bg-surface-2 border border-border px-3 py-2 text-sm text-text outline-none placeholder:text-text-3 focus:border-accent focus:shadow-focus transition"
          />
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-inset p-0.5 flex-wrap">
            {kindFilters.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilterValue(f.value)}
                className={[
                  'px-2.5 py-1 rounded-md text-xs font-semibold transition outline-none',
                  filterValue === f.value
                    ? 'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-text'
                    : 'text-text-3 hover:text-text-2',
                ].join(' ')}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-10 text-center text-text-3 text-sm">
            No results match "{q}". Try a different term.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <CatalogCard
                key={c.subtype}
                entry={c}
                connectedCount={connectedBySubtype.get(c.subtype)?.length ?? 0}
                onClick={() => setOpenSubtype(c.subtype)}
              />
            ))}
          </div>
        )}
      </section>

      {openEntry ? (
        <ConnectDrawer
          envSlug={envSlug}
          entry={openEntry}
          onClose={() => setOpenSubtype(null)}
          onConnected={() => {
            setOpenSubtype(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CatalogCard({
  entry,
  connectedCount,
  onClick,
}: {
  entry: CatalogEntry;
  connectedCount: number;
  onClick: () => void;
}) {
  const isAvailable = entry.status === 'available';
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-2xl border border-border bg-surface shadow-card p-4 hover:bg-surface-2 transition group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="w-10 h-10 rounded-md bg-inset border border-border flex items-center justify-center font-mono text-sm font-bold text-text-2">
          {entry.icon}
        </div>
        {connectedCount > 0 ? (
          <span className="inline-flex items-center gap-1 font-mono text-2xs font-semibold text-green bg-green-soft px-2 py-0.5 rounded-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-green" />
            {connectedCount} connected
          </span>
        ) : isAvailable ? (
          <span className="font-mono text-2xs font-semibold text-text-2 bg-inset px-2 py-0.5 rounded-sm">
            available
          </span>
        ) : (
          <span className="font-mono text-2xs font-semibold text-amber bg-amber-soft px-2 py-0.5 rounded-sm">
            coming soon
          </span>
        )}
      </div>
      <div className="text-base font-semibold text-text">{entry.name}</div>
      <div className="text-xs text-text-2 mt-1 leading-snug">{entry.tagline}</div>
      <div className="mt-3 flex flex-wrap gap-1">
        {entry.tags.map((t) => (
          <span
            key={t}
            className="font-mono text-2xs text-text-3 bg-inset px-1.5 py-0.5 rounded-sm"
          >
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}

/** Re-exported so caller can type-check kind-filter predicates. */
export type { CatalogEntry, ConnectedRow, ConnectorKind };
