import Link from 'next/link';
import { api, type AlertChannel } from '@/lib/api';

const TYPE_BADGE: Record<string, string> = {
  slack: 'bg-purple-950 text-purple-300 border-purple-900',
  discord: 'bg-indigo-950 text-indigo-300 border-indigo-900',
  webhook: 'bg-slate-800 text-slate-300 border-slate-700',
};

export default async function ChannelsPage() {
  let channels: AlertChannel[] = [];
  let error: string | null = null;
  try {
    const res = await api<{ alert_channels: AlertChannel[] }>(
      '/v1/alert-channels?include_disabled=true',
    );
    channels = res.alert_channels;
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alert channels</h1>
          <p className="mt-1 text-sm text-argus-muted">
            Where findings get delivered. Slack, Discord, and HMAC-signed generic webhooks. Each
            channel has a minimum-severity gate.
          </p>
        </div>
        <Link
          href="/channels/new"
          className="rounded border border-argus-accent bg-argus-accent/10 px-3 py-1.5 text-sm text-argus-accent hover:bg-argus-accent/20"
        >
          + New channel
        </Link>
      </div>

      {error ? (
        <div className="rounded border border-argus-border bg-argus-panel p-4 text-sm text-argus-danger">
          API unreachable: <code className="font-mono">{error}</code>
        </div>
      ) : channels.length === 0 ? (
        <div className="rounded border border-argus-border bg-argus-panel p-8 text-center">
          <h2 className="text-lg font-medium">No channels yet</h2>
          <p className="mt-2 text-sm text-argus-muted">
            Add a destination —{' '}
            <Link className="text-argus-accent hover:underline" href="/channels/new">
              New channel
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {channels.map((c) => {
            const minSev = (c.config?.['min_severity'] as string | undefined) ?? 'low';
            return (
              <li key={c.id}>
                <Link
                  href={`/channels/${c.id}`}
                  className="block rounded border border-argus-border bg-argus-panel p-4 transition hover:border-argus-accent/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-medium text-slate-100">{c.name}</span>
                        <span className="rounded border border-argus-border px-2 py-0.5 font-mono text-xs text-argus-muted">
                          {c.id}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                            TYPE_BADGE[c.type] ?? TYPE_BADGE.webhook
                          }`}
                        >
                          {c.type}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-argus-muted">
                        Min severity: <span className="font-mono">{minSev}</span>
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-xs ${
                        c.enabled ? 'text-argus-ok' : 'text-argus-muted'
                      }`}
                    >
                      {c.enabled ? '● enabled' : '○ disabled'}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
