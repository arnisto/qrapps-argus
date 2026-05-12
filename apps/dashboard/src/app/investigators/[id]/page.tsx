import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, type Agent, type AlertChannel, type Investigator, type PipelineAgentEntry } from '@/lib/api';
import { PipelineBuilder, type PipelineInitial } from '@/components/PipelineBuilder';
import { updateInvestigator, deleteInvestigator } from '../actions';

interface InvestigatorRow extends Investigator {
  definition: {
    triggers?: { events?: string[]; schedule?: string };
    context?: { lookback?: string; related_events?: string[]; max_events?: number };
    output?: { alert_channels?: string[] };
  };
}

export default async function EditInvestigatorPage({ params }: { params: { id: string } }) {
  let inv: InvestigatorRow;
  let pipelineAgents: PipelineAgentEntry[] = [];
  let availableAgents: Agent[] = [];
  let channels: AlertChannel[] = [];

  try {
    const [detail, ag, ch] = await Promise.all([
      api<{ investigator: InvestigatorRow; agents: PipelineAgentEntry[] }>(
        `/v1/investigators/${params.id}`,
      ),
      api<{ agents: Agent[] }>('/v1/agents'),
      api<{ alert_channels: AlertChannel[] }>('/v1/alert-channels'),
    ]);
    inv = detail.investigator;
    pipelineAgents = detail.agents;
    availableAgents = ag.agents;
    channels = ch.alert_channels;
  } catch {
    return notFound();
  }

  const isBuiltin = inv.source === 'builtin';
  const isLegacy = inv.definition_schema_version < 2;

  const initial: PipelineInitial = {
    id: inv.id,
    name: inv.name,
    description: inv.description,
    triggers: {
      events: inv.definition?.triggers?.events ?? [],
      ...(inv.definition?.triggers?.schedule ? { schedule: inv.definition.triggers.schedule } : {}),
    },
    context: {
      lookback: inv.definition?.context?.lookback ?? '24h',
      related_events: inv.definition?.context?.related_events ?? [],
      max_events: inv.definition?.context?.max_events ?? 400,
    },
    severity_threshold: inv.severity_threshold,
    output: { alert_channels: inv.definition?.output?.alert_channels ?? [] },
    agents: pipelineAgents.map((a) => ({ agent_id: a.agent_id, position: a.position })),
  };

  return (
    <div className="max-w-4xl">
      <Link href="/investigators" className="text-sm text-argus-accent hover:underline">
        ← Back to investigators
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{inv.name}</h1>
      <p className="mt-1 font-mono text-xs text-argus-muted">
        {inv.id} · {pipelineAgents.length} agent{pipelineAgents.length === 1 ? '' : 's'}
        {isBuiltin && <span className="ml-2 text-argus-accent">builtin</span>}
        {isLegacy && <span className="ml-2 text-amber-400">legacy v1 (no agents — pipeline will replace)</span>}
      </p>

      <div className="mt-6">
        <PipelineBuilder
          availableAgents={availableAgents}
          alertChannels={channels}
          initial={initial}
          isBuiltin={isBuiltin}
          submitLabel="Save changes"
          action={updateInvestigator.bind(null, inv.id)}
        />
      </div>

      {!isBuiltin && (
        <form
          action={deleteInvestigator.bind(null, inv.id)}
          className="mt-6 rounded border border-argus-danger/40 bg-argus-panel p-4"
        >
          <p className="text-sm text-slate-300">
            Delete this investigator. Cascades to its investigations and findings.
          </p>
          <button
            type="submit"
            className="mt-3 rounded border border-argus-danger px-3 py-1.5 text-sm text-argus-danger hover:bg-argus-danger/10"
          >
            Delete investigator
          </button>
        </form>
      )}
    </div>
  );
}
