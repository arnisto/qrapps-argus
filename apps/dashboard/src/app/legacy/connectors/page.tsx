import Link from 'next/link';
import { api, type Connector } from '@/lib/api';
import { TestNowButton } from '@/components/ds/TestNowButton';
import { Chip } from '@/components/ds/Chip';

export const dynamic = 'force-dynamic';

/**
 * Connectors list. Row layout (left → right):
 *
 *   [info column] [action column · "Test now" + "Open ›"] [status indicator]
 *
 * The row is NOT a single Link wrapper anymore — clicking "Test now" used to
 * race with the Link's nav (and the absolute-positioned overlay sat on a
 * confusing z-order). Splitting the cells into a flex grid lets us use a
 * proper button for the action and a proper Link for navigation, with no
 * propagation tricks needed.
 */
export default async function ConnectorsPage() {
  let connectors: Connector[] = [];
  let error: string | null = null;
  try {
    const res = await api<{ connectors: Connector[] }>('/v1/connectors');
    connectors = res.connectors;
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
          <p className="mt-1 text-sm text-argus-muted">
            Where Argus reads operational data from. Postgres (local + cloud) supported. Click{' '}
            <strong>Test now</strong> to validate the saved credentials against the source.
          </p>
        </div>
        <Link
          href="/connectors/new"
          className="rounded border border-argus-accent bg-argus-accent/10 px-3 py-1.5 text-sm text-argus-accent hover:bg-argus-accent/20"
        >
          + New connector
        </Link>
      </div>

      {error ? (
        <div className="rounded border border-argus-border bg-argus-panel p-4 text-sm text-argus-danger">
          API unreachable: <code className="font-mono">{error}</code>
        </div>
      ) : connectors.length === 0 ? (
        <div className="rounded border border-argus-border bg-argus-panel p-8 text-center">
          <h2 className="text-lg font-medium">No connectors yet</h2>
          <p className="mt-2 text-sm text-argus-muted">
            Connect Postgres —{' '}
            <Link className="text-argus-accent hover:underline" href="/connectors/new">
              New connector
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {connectors.map((c) => (
            <li
              key={c.id}
              className="rounded border border-argus-border bg-argus-panel p-4"
            >
              <div
                className="grid items-start gap-4"
                style={{ gridTemplateColumns: '1fr auto auto' }}
              >
                {/* info column */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-medium text-slate-100">{c.name}</h2>
                    <span className="rounded border border-argus-border px-2 py-0.5 font-mono text-xs text-argus-muted">
                      {c.id}
                    </span>
                    <span className="rounded bg-argus-accent/10 px-2 py-0.5 text-xs text-argus-accent">
                      {c.type}
                    </span>
                    {c.last_test_at && (
                      <Chip tone={c.last_test_ok ? 'emerald' : 'rose'} size="sm">
                        {c.last_test_ok ? '✓ test ok' : '✗ test failed'}
                      </Chip>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-argus-muted">
                    Last sync:{' '}
                    <span className={c.last_sync_at ? '' : 'italic'}>
                      {c.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : 'never'}
                    </span>
                    {c.last_test_at && (
                      <>
                        {' · Last test: '}
                        <span className="mono">
                          {new Date(c.last_test_at).toLocaleString()}
                        </span>
                      </>
                    )}
                  </p>
                  {c.last_error && (
                    <p className="mt-1 text-xs text-argus-danger">
                      Sync error: <span className="font-mono">{c.last_error}</span>
                    </p>
                  )}
                  {!c.last_test_ok && c.last_test_error && (
                    <p className="mt-1 text-xs text-argus-danger">
                      Test error: <span className="font-mono">{c.last_test_error}</span>
                    </p>
                  )}
                </div>

                {/* action column — Test now lives in its own cell now */}
                <div className="flex items-center gap-2">
                  <TestNowButton connectorId={c.id} />
                  <Link
                    href={`/connectors/${c.id}`}
                    className="ds-btn sm"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Open ›
                  </Link>
                </div>

                {/* status column */}
                <span
                  className={`shrink-0 text-xs self-center ${
                    c.enabled ? 'text-argus-ok' : 'text-argus-muted'
                  }`}
                >
                  {c.enabled ? '● enabled' : '○ disabled'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
