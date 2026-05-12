'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ConnectorTestResult } from '@/lib/api';

/**
 * "Test now" — fires `POST /api/connectors/:id/test` (a Next route handler in
 * this app) which in turn calls the Argus API server-side and persists the
 * result. We use a plain `fetch` instead of a Next server action because:
 *
 *   1. Server actions in dev mode rely on a per-render action-ID hash; that
 *      hash can desync from the client bundle after HMR and clicks silently
 *      no-op.
 *   2. A route handler is a regular HTTP endpoint, easy to debug in the
 *      Network tab, and easy to invoke from outside the dashboard (e.g. curl).
 *
 * UX:
 *   - Button label is the live status (Test now → ⟳ Testing… → ✓/✗ result).
 *   - Result stays visible until the next click.
 *   - On success: triggers `router.refresh()` so the row's persisted state
 *     (last_test_at chip, timestamp line) reflects the new test outcome.
 */
interface Props {
  connectorId: string;
  size?: 'sm' | 'md';
}

export function TestNowButton({ connectorId, size = 'sm' }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ConnectorTestResult | null>(null);

  let label = 'Test now';
  let tone = '';
  let title: string | undefined;

  if (pending) {
    label = '⟳ Testing…';
    tone = 'pending';
  } else if (result) {
    if (result.ok) {
      label = `✓ Connection OK · ${result.current_user ?? 'connected'}`;
      tone = 'ok';
      title = `Last test: success — ${result.mappings.length} mapping(s) reachable. Click to retest.`;
    } else {
      const err = (result.error ?? 'failed').replace(/\s+/g, ' ').slice(0, 70);
      label = `✗ ${err}`;
      tone = 'fail';
      title = `Last test failed. Click to retest.`;
    }
  }

  async function runTest() {
    setPending(true);
    try {
      const res = await fetch(`/api/connectors/${connectorId}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      let data: ConnectorTestResult;
      try {
        data = (await res.json()) as ConnectorTestResult;
      } catch {
        data = {
          ok: false,
          error: `non-JSON response (HTTP ${res.status})`,
          mappings: [],
        };
      }
      setResult(data);
      if (data.ok) {
        // Refresh the route so the row picks up the persisted last_test_*.
        router.refresh();
      }
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : 'fetch failed',
        mappings: [],
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      title={title}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void runTest();
      }}
      className={[
        'ds-btn',
        size === 'sm' ? 'sm' : '',
        tone === 'ok' ? 'success' : '',
        tone === 'fail' ? 'danger' : '',
        tone === 'pending' ? 'primary' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        minWidth: 110,
        maxWidth: 460,
        textAlign: 'left',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </button>
  );
}
