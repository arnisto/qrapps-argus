import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, type AgentDetail } from '@/lib/api';
import { AgentForm } from '@/components/AgentForm';
import { updateAgent, deleteAgent } from '../actions';

export default async function EditAgentPage({ params }: { params: { id: string } }) {
  let agent: AgentDetail;
  try {
    const res = await api<{ agent: AgentDetail }>(`/v1/agents/${params.id}`);
    agent = res.agent;
  } catch {
    return notFound();
  }

  const isBuiltin = agent.source === 'builtin';

  return (
    <div className="max-w-3xl">
      <Link href="/agents" className="text-sm text-argus-accent hover:underline">
        ← Back to agents
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{agent.name}</h1>
      <p className="mt-1 font-mono text-xs text-argus-muted">
        {agent.id} · {agent.provider} · {agent.model}
        {isBuiltin && <span className="ml-2 text-argus-accent">builtin</span>}
      </p>

      <div className="mt-6 rounded border border-argus-border bg-argus-panel p-6">
        <AgentForm
          initial={agent}
          isBuiltin={isBuiltin}
          submitLabel="Save changes"
          action={updateAgent.bind(null, agent.id)}
        />
      </div>

      {!isBuiltin && (
        <form
          action={deleteAgent.bind(null, agent.id)}
          className="mt-6 rounded border border-argus-danger/40 bg-argus-panel p-4"
        >
          <p className="text-sm text-slate-300">
            Delete this agent. Fails if any pipeline references it; detach first.
          </p>
          <button
            type="submit"
            className="mt-3 rounded border border-argus-danger px-3 py-1.5 text-sm text-argus-danger hover:bg-argus-danger/10"
          >
            Delete agent
          </button>
        </form>
      )}
    </div>
  );
}
