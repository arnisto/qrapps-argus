'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Soft auto-refresh control for "live monitor" pages.
 *
 * Calls `router.refresh()` on an interval — re-fetches the server component
 * tree without remounting the client UI, so scroll position, focus, and any
 * client-side state (collapsed sections, dropdowns) survive.
 *
 * Replaces `<meta httpEquiv="refresh" content="N" />`, which does a full
 * navigation reload every N seconds and blinks the entire page.
 */
interface Props {
  /** Default interval in seconds. */
  intervalSeconds?: number;
  /** Storage key for the user's paused-state preference. */
  storageKey?: string;
}

export function AutoRefresh({ intervalSeconds = 10, storageKey = 'argus.autorefresh' }: Props) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const [secondsToNext, setSecondsToNext] = useState(intervalSeconds);

  // Hydrate paused state from localStorage so the preference survives
  // navigations.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === 'paused') setPaused(true);
    } catch {
      /* ignore — private mode etc. */
    }
  }, [storageKey]);

  useEffect(() => {
    if (paused) return;
    setSecondsToNext(intervalSeconds);
    const id = window.setInterval(() => {
      setSecondsToNext((s) => {
        if (s <= 1) {
          router.refresh();
          setTick((t) => t + 1);
          return intervalSeconds;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [paused, intervalSeconds, router]);

  return (
    <div
      className="flex items-center gap-2 text-fg-3"
      style={{ fontSize: 11 }}
      title={paused ? 'Auto-refresh is paused' : `Refreshing every ${intervalSeconds}s`}
    >
      <span
        className="rounded-full"
        style={{
          width: 8,
          height: 8,
          background: paused ? 'var(--fg-3)' : 'var(--emerald)',
          boxShadow: paused ? 'none' : '0 0 6px var(--emerald)',
          animation: paused ? undefined : 'pulse-ring 1.4s ease-out infinite',
        }}
        aria-hidden
      />
      <span className="mono">
        {paused ? 'paused' : `next refresh in ${secondsToNext}s`}{' '}
        <span className="text-fg-3">· tick {tick}</span>
      </span>
      <button
        type="button"
        onClick={() => {
          setPaused((p) => {
            const next = !p;
            try {
              window.localStorage.setItem(storageKey, next ? 'paused' : 'auto');
            } catch {
              /* ignore */
            }
            return next;
          });
        }}
        className="ds-btn sm ghost"
        style={{ fontSize: 11, padding: '2px 8px' }}
      >
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button
        type="button"
        onClick={() => {
          router.refresh();
          setSecondsToNext(intervalSeconds);
        }}
        className="ds-btn sm"
        style={{ fontSize: 11, padding: '2px 8px' }}
      >
        Refresh now
      </button>
    </div>
  );
}
