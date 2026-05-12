import Link from 'next/link';
import { api, type Agent, type AlertChannel } from '@/lib/api';
import { PipelineBuilder } from '@/components/PipelineBuilder';
import { createInvestigator } from '../actions';
import { Card, CardHeader, CardBody } from '@/components/ds/Card';
import { Chip, AgentBadge } from '@/components/ds/Chip';
import { BacktestStrip } from '@/components/ds/BacktestStrip';

export const dynamic = 'force-dynamic';

/**
 * Workshop — Screen 4 of the design. The "author an investigator" surface.
 *
 * The design has 3 conceptual zones:
 *   1. Top: NL prompt panel + chip suggestions ("What should I watch for?")
 *   2. Middle: Semantic plan / SQL preview / Schedule tabs + 90-day backtest
 *   3. Right: Configuration sidebar + schema coverage
 *
 * v0.2 wires these as presentational scaffolding on top of the working
 * PipelineBuilder. The actual save still goes through the existing form +
 * server action; the design surfaces explain to users what they're authoring
 * before they configure it. NL→plan compilation is a v0.3 milestone — for
 * now the prompt is a stylistic frame around concrete pipeline composition.
 */
export default async function WorkshopPage() {
  let agents: Agent[] = [];
  let channels: AlertChannel[] = [];
  let error: string | null = null;
  try {
    const [a, c] = await Promise.all([
      api<{ agents: Agent[] }>('/v1/agents'),
      api<{ alert_channels: AlertChannel[] }>('/v1/alert-channels'),
    ]);
    agents = a.agents;
    channels = c.alert_channels;
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <>
      {/* breadcrumb */}
      <div
        className="flex items-center gap-3"
        style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', fontSize: 12 }}
      >
        <Link href="/investigators" className="text-fg-3 hover:text-fg-1">
          Investigators
        </Link>
        <span className="text-fg-3">›</span>
        <span className="font-medium">New investigator</span>
        <div className="flex-1" />
        <span className="mono text-fg-3" style={{ fontSize: 11 }}>
          autosaved · draft
        </span>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr 380px',
          gap: 16,
          padding: 16,
          minHeight: 0,
        }}
      >
        {/* main column */}
        <div className="flex flex-col gap-3 min-w-0">
          <NlPromptPanel />

          <Card>
            <CardHeader>
              <div className="ds-tabs">
                <span className="ds-tab">Semantic plan</span>
                <span className="ds-tab active">Pipeline</span>
                <span className="ds-tab">Schedule</span>
              </div>
              <span className="mono text-fg-3 ml-auto" style={{ fontSize: 11 }}>
                compiles against ·{' '}
                <span className="text-fg-1 font-medium">your connectors</span>
              </span>
            </CardHeader>
            <CardBody>
              {error ? (
                <div className="text-rose" style={{ fontSize: 13 }}>
                  {error}
                </div>
              ) : agents.length === 0 ? (
                <div className="text-center" style={{ padding: 20 }}>
                  <h2 className="font-medium" style={{ fontSize: 16 }}>
                    No agents available
                  </h2>
                  <p className="text-fg-2 mt-2" style={{ fontSize: 13 }}>
                    Create at least one <code>finding</code>-kind agent first —{' '}
                    <Link className="text-blue hover:underline" href="/agents/new">
                      New agent
                    </Link>
                    .
                  </p>
                </div>
              ) : (
                <PipelineBuilder
                  availableAgents={agents}
                  alertChannels={channels}
                  action={createInvestigator}
                  submitLabel="Create investigator"
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className="font-semibold">Backtest · last 90 days</span>
              <span className="mono text-fg-3 ml-auto" style={{ fontSize: 11 }}>
                would have fired <span className="font-medium text-fg-1">7×</span> · precision 0.86
              </span>
            </CardHeader>
            <CardBody>
              <BacktestStrip />
              <p
                className="mono text-fg-3"
                style={{ margin: '6px 0 0', fontSize: 10.5 }}
              >
                Live backtest against historical events ships in v0.3 — the chart above shows the
                expected firing cadence.
              </p>
            </CardBody>
          </Card>
        </div>

        {/* right sidebar */}
        <div className="flex flex-col gap-3 min-w-0">
          <Card>
            <CardHeader>
              <span className="font-semibold">Configuration</span>
              <Chip tone="blue" size="sm" className="ml-auto">
                live preview
              </Chip>
            </CardHeader>
            <CardBody className="flex flex-col gap-3" style={{ fontSize: 12.5 }}>
              <p className="text-fg-2" style={{ margin: 0 }}>
                Investigator-level config (name, triggers, severity threshold, alert channels) is
                set inside the Pipeline form on the left.
              </p>
              <div className="flex flex-col gap-1">
                <span className="uppercase-mini text-fg-3">Available agents</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {agents.slice(0, 6).map((a) => (
                    <span
                      key={a.id}
                      className="flex items-center gap-2"
                      style={{ fontSize: 12 }}
                    >
                      <AgentBadge
                        tone={
                          a.output_schema_kind === 'finding'
                            ? 'emerald'
                            : a.output_schema_kind === 'analysis'
                              ? 'blue'
                              : 'neutral'
                        }
                        size={18}
                      >
                        {a.id.slice(0, 2).toUpperCase()}
                      </AgentBadge>
                      <span className="mono text-fg-3" style={{ fontSize: 10.5 }}>
                        {a.id}
                      </span>
                    </span>
                  ))}
                  {agents.length > 6 && (
                    <span className="mono text-fg-3" style={{ fontSize: 11 }}>
                      +{agents.length - 6} more
                    </span>
                  )}
                </div>
              </div>
              <Link
                href="/agents/new"
                className="ds-btn sm"
                style={{ alignSelf: 'flex-start' }}
              >
                + New agent…
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className="font-semibold">Connectors available</span>
            </CardHeader>
            <CardBody className="flex flex-col gap-2" style={{ fontSize: 12 }}>
              <p className="text-fg-2" style={{ margin: '0 0 6px', fontSize: 12 }}>
                Sources Argus can pull events from for this investigator.
              </p>
              <ConnectorsCoverage />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className="font-semibold">Alert channels</span>
            </CardHeader>
            <CardBody className="flex flex-wrap gap-2" style={{ fontSize: 12 }}>
              {channels.length === 0 && (
                <span className="text-fg-3">No channels configured yet.</span>
              )}
              {channels.slice(0, 6).map((c) => (
                <Chip key={c.id} tone={c.type === 'slack' ? 'blue' : 'neutral'} size="sm">
                  {c.name}
                </Chip>
              ))}
              <Link
                href="/channels/new"
                className="ds-btn sm ghost"
                style={{ fontSize: 11 }}
              >
                + new
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * The "What should I watch for?" prompt panel — presentational only for v0.2.
 * In v0.3 this becomes a real NL → pipeline-template compiler powered by a
 * Claude-backed agent.
 */
function NlPromptPanel() {
  const suggestions = [
    'Spikes in refunds by region',
    'Unusual carrier delay patterns',
    'Cross-sell windows opening today',
    'SKUs trending below restock',
  ];
  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">What should I watch for?</span>
        <Chip tone="blue" size="sm" className="ml-auto">
          natural language → pipeline
        </Chip>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 14,
            display: 'flex',
            gap: 12,
          }}
        >
          <AgentBadge tone="blue" size={26}>
            NL
          </AgentBadge>
          <div className="flex flex-col gap-2 grow">
            <div
              style={{
                fontSize: 14.5,
                lineHeight: 1.5,
                letterSpacing: '-0.005em',
                color: 'var(--fg-2)',
              }}
            >
              Describe what Argus should watch for, in plain English. We&apos;ll compile your
              description into the multi-agent pipeline below — you stay in control of the agents,
              triggers, and thresholds.
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Chip key={s} tone="blue" size="sm">
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        </div>
        <p className="mono text-fg-3" style={{ margin: 0, fontSize: 10.5 }}>
          NL compiler ships in v0.3. For now, compose the pipeline manually below — the agents,
          triggers, and severity gates you pick are what actually run.
        </p>
      </CardBody>
    </Card>
  );
}

async function ConnectorsCoverage() {
  let rows: { id: string; name: string; enabled: boolean; last_sync_at: string | null }[] = [];
  try {
    const res = await api<{
      connectors: { id: string; name: string; enabled: boolean; last_sync_at: string | null }[];
    }>('/v1/connectors');
    rows = res.connectors;
  } catch {
    return <span className="text-fg-3">Unable to load connectors.</span>;
  }

  if (rows.length === 0) {
    return (
      <span className="text-fg-3">
        No connectors yet —{' '}
        <Link href="/connectors/new" className="text-blue hover:underline">
          add one
        </Link>
        .
      </span>
    );
  }

  return (
    <>
      {rows.map((c) => (
        <div key={c.id} className="flex items-center gap-2" style={{ fontSize: 12 }}>
          <AgentBadge tone={c.enabled ? 'blue' : 'neutral'} size={18}>
            {c.enabled ? '○' : '×'}
          </AgentBadge>
          <span className="mono grow truncate">{c.name}</span>
          <span className="text-fg-3" style={{ fontSize: 11 }}>
            {c.last_sync_at ? new Date(c.last_sync_at).toLocaleDateString() : 'never'}
          </span>
        </div>
      ))}
    </>
  );
}
