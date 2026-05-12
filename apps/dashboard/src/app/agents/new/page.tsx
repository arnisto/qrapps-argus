import Link from 'next/link';
import { AgentForm } from '@/components/AgentForm';
import { createAgent } from '../actions';

export default function NewAgentPage() {
  return (
    <div className="max-w-3xl">
      <Link href="/agents" className="text-sm text-argus-accent hover:underline">
        ← Back to agents
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">New agent</h1>
      <p className="mt-1 text-sm text-argus-muted">
        One reusable LLM step. Pick a provider, write its prompt, and choose an output kind.
      </p>
      <div className="mt-6 rounded border border-argus-border bg-argus-panel p-6">
        <AgentForm action={createAgent} submitLabel="Create agent" />
      </div>
    </div>
  );
}
