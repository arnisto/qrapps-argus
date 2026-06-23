'use client';

import { useState } from 'react';
import type { CatalogEntry, ConnectedRow } from '@/lib/connectors-server';

export interface CardAction {
  label: string;
  tone?: 'primary' | 'secondary';
  onAct: (row: ConnectedRow) => Promise<void> | void;
}

/**
 * A single "connected" card in the marketplace. Used in both the Connectors
 * and Channels pages. Per-subtype actions are injected from the caller
 * (e.g. Channels page wants a "Send test message" button on Slack rows).
 */
export function ConnectedCard({
  row,
  entry,
  actions,
  onRemove,
}: {
  row: ConnectedRow;
  entry: CatalogEntry | undefined;
  actions?: CardAction[];
  onRemove: () => void;
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  async function runAction(a: CardAction) {
    setRunning(a.label);
    setFeedback(null);
    try {
      await a.onAct(row);
      setFeedback({ tone: 'ok', text: `${a.label} ✓` });
    } catch (err) {
      setFeedback({ tone: 'err', text: (err as Error).message });
    } finally {
      setRunning(null);
      setTimeout(() => setFeedback(null), 4000);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-md bg-inset border border-border flex items-center justify-center font-mono text-sm font-bold text-text-2">
          {entry?.icon ?? row.subtype.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text truncate">{row.name}</div>
          <div className="font-mono text-2xs text-text-3 mt-0.5">
            {row.subtype}
            {row.source_count > 0 ? ` · ${row.source_count} sources` : ''}
          </div>
        </div>
        <span
          className={[
            'inline-flex items-center gap-1 font-mono text-2xs font-semibold px-2 py-0.5 rounded-sm',
            row.status === 'connected'
              ? 'text-green bg-green-soft'
              : row.status === 'error'
                ? 'text-red bg-red-soft'
                : 'text-amber bg-amber-soft',
          ].join(' ')}
        >
          {row.status === 'connected' && <span className="w-1.5 h-1.5 rounded-full bg-green" />}
          {row.status}
        </span>
      </div>

      {row.status_detail ? (
        <p className="mt-3 text-xs text-text-2 leading-snug">{row.status_detail}</p>
      ) : null}

      {actions?.length || feedback ? (
        <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
          {feedback ? (
            <span
              className={[
                'text-2xs font-mono',
                feedback.tone === 'ok' ? 'text-green' : 'text-red',
              ].join(' ')}
            >
              {feedback.text}
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5">
            {actions?.map((a) => (
              <button
                key={a.label}
                type="button"
                disabled={running !== null}
                onClick={() => void runAction(a)}
                className={[
                  'text-2xs font-semibold rounded-md px-2.5 py-1 transition',
                  a.tone === 'primary'
                    ? 'bg-accent text-white hover:opacity-90'
                    : 'border border-border bg-surface text-text-2 hover:text-text hover:bg-inset',
                  running !== null ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
              >
                {running === a.label ? '…' : a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={onRemove}
              className="text-2xs font-semibold rounded-md text-red border border-red/40 bg-red-soft px-2.5 py-1 hover:bg-red/15 transition"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onRemove}
            className="text-2xs font-semibold rounded-md text-red border border-red/40 bg-red-soft px-2.5 py-1 hover:bg-red/15 transition"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
