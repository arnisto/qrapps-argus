import Link from 'next/link';
import { api, type Agent } from '@/lib/api';

const KIND_BADGE = {
  text: 'bg-slate-800 text-slate-300 border-slate-700',
  analysis: 'bg-sky-950 text-sky-300 border-sky-900',
  finding: 'bg-emerald-950 text-emerald-300 border-emerald-900',
} as const;

export default async function AgentsPage() {
  let agents: Agent[] = [];
  let error: string | null = null;
  try {
    const res = await api<{ agents: Agent[] }>('/v1/agents');
    agents = res.agents;
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-argus-muted">
            Reusable LLM steps. Compose into pipelines from the Investigators page.
          </p>
        </div>
        <Link
          href="/agents/new"
          className="rounded border border-argus-accent bg-argus-accent/10 px-3 py-1.5 text-sm text-argus-accent hover:bg-argus-accent/20"
        >
          + New agent
        </Link>
      </div>

      {error ? (
        <div className="rounded border border-argus-border bg-argus-panel p-4 text-sm text-argus-danger">
          API unreachable: <code className="font-mono">{error}</code>
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded border border-argus-border bg-argus-panel p-8 text-center">
          <h2 className="text-lg font-medium">No agents yet</h2>
          <p className="mt-2 text-sm text-argus-muted">
            Create your first agent —{' '}
            <Link className="text-argus-accent hover:underline" href="/agents/new">
              New agent
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {agents.map((a) => (
            <li key={a.id}>
              <Link
                href={`/agents/${a.id}`}
                className="block rounded border border-argus-border bg-argus-panel p-4 transition hover:border-argus-accent/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium text-slate-100">{a.name}</span>
                      <span className="rounded border border-argus-border px-2 py-0.5 font-mono text-xs text-argus-muted">
                        {a.id}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${KIND_BADGE[a.output_schema_kind]}`}
                      >
                        {a.output_schema_kind}
                      </span>
                      {a.source === 'builtin' && (
                        <span className="rounded bg-argus-accent/10 px-2 py-0.5 text-xs text-argus-accent">
                          builtin
                        </span>
                      )}
                    </div>
                    {a.description && (
                      <p className="mt-2 text-sm text-slate-300">{a.description}</p>
                    )}
                    <p className="mt-1 font-mono text-xs text-argus-muted">
                      {a.provider} · {a.model}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-argus-muted">
                    {new Date(a.updated_at).toLocaleString()}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
