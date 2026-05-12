import Link from 'next/link';
import { api, type Investigator } from '@/lib/api';

export default async function InvestigatorsPage() {
  let investigators: Investigator[] = [];
  let error: string | null = null;
  try {
    const res = await api<{ investigators: Investigator[] }>('/v1/investigators');
    investigators = res.investigators;
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Investigators</h1>
          <p className="mt-1 text-sm text-argus-muted">
            Pipelines of agents that watch for one specific class of operational problem.
          </p>
        </div>
        <Link
          href="/investigators/new"
          className="rounded border border-argus-accent bg-argus-accent/10 px-3 py-1.5 text-sm text-argus-accent hover:bg-argus-accent/20"
        >
          + New investigator
        </Link>
      </div>

      {error ? (
        <div className="rounded border border-argus-border bg-argus-panel p-4 text-sm text-argus-danger">
          API unreachable: <code className="font-mono">{error}</code>
        </div>
      ) : (
        <ul className="space-y-3">
          {investigators.map((inv) => {
            const agentCount = Number(inv.agent_count ?? 0);
            const isLegacy = agentCount === 0 && (inv.definition_schema_version ?? 1) < 2;
            return (
              <li key={inv.id}>
                <Link
                  href={`/investigators/${inv.id}`}
                  className="block rounded border border-argus-border bg-argus-panel p-4 transition hover:border-argus-accent/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-medium">{inv.name}</h2>
                        <span className="rounded border border-argus-border px-2 py-0.5 font-mono text-xs text-argus-muted">
                          {inv.id}
                        </span>
                        {inv.source === 'builtin' && (
                          <span className="rounded bg-argus-accent/10 px-2 py-0.5 text-xs text-argus-accent">
                            builtin
                          </span>
                        )}
                        {isLegacy && (
                          <span className="rounded border border-amber-900 bg-amber-950 px-2 py-0.5 text-xs text-amber-300">
                            legacy
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{inv.description}</p>
                      <p className="mt-2 text-xs text-argus-muted">
                        Threshold: <span className="font-mono">{inv.severity_threshold}</span> ·{' '}
                        Agents: <span className="font-mono">{agentCount}</span>
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-xs ${
                        inv.enabled ? 'text-argus-ok' : 'text-argus-muted'
                      }`}
                    >
                      {inv.enabled ? '● enabled' : '○ disabled'}
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
