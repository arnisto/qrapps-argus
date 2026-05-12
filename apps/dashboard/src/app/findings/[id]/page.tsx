import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, type AgentRun, type Finding, type InvestigationDetail } from '@/lib/api';
import { Card, CardHeader, CardBody } from '@/components/ds/Card';
import { Chip, AgentBadge } from '@/components/ds/Chip';
import type { Tone } from '@/components/ds/Chip';
import { EvidenceChart } from '@/components/ds/EvidenceChart';
import { ReasoningTimeline } from '@/components/ReasoningTimeline';
import { CloseLoopButton } from '@/components/ds/CloseLoopButton';

export const dynamic = 'force-dynamic';

/**
 * Finding detail — Screen 2 of the design.
 *
 * 2-column layout: main column has the header card, reasoning trace, and
 * evidence chart; right sidebar has the recommendation panel (with the 3-step
 * action plan + Close-the-loop CTA) and a "related" panel.
 *
 * The reasoning trail uses real `agent_runs` data; the design-style summary
 * card above it shows the high-level confidence + sources from the Finding
 * row. The evidence chart is currently a representative shape until we wire
 * the events query to bucket the cited event_ids by time.
 */
export default async function FindingDetailPage({ params }: { params: { id: string } }) {
  let finding: Finding;
  try {
    const res = await api<{ finding: Finding }>(`/v1/findings/${params.id}`);
    finding = res.finding;
  } catch {
    return notFound();
  }

  let investigation: InvestigationDetail | null = null;
  let agentRuns: AgentRun[] = [];
  try {
    const lookup = await api<{ investigation_id: string }>(
      `/v1/investigations?finding_id=${finding.id}`,
    );
    const reasoning = await api<{ investigation: InvestigationDetail; agent_runs: AgentRun[] }>(
      `/v1/investigations/${lookup.investigation_id}/reasoning`,
    );
    investigation = reasoning.investigation;
    agentRuns = reasoning.agent_runs;
  } catch {
    /* tolerate */
  }

  const tone = severityToTone(finding.severity);
  const ago = relativeTime(finding.created_at);

  return (
    <>
      {/* breadcrumb */}
      <div
        className="flex items-center gap-3"
        style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', fontSize: 12 }}
      >
        <Link href="/" className="text-fg-3 hover:text-fg-1">
          Today
        </Link>
        <span className="text-fg-3">›</span>
        <Link href="/findings" className="text-fg-3 hover:text-fg-1">
          Findings
        </Link>
        <span className="text-fg-3">›</span>
        <span className="mono">
          #{finding.id.slice(0, 8)} · {finding.investigator_id}
        </span>
        <div className="flex-1" />
        <Link href="/findings" className="ds-btn sm ghost">
          ‹ All findings
        </Link>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr 360px',
          gap: 16,
          padding: 16,
          minHeight: 0,
        }}
      >
        {/* main */}
        <div className="flex flex-col gap-3 min-w-0">
          {/* header card */}
          <Card>
            <CardBody className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <AgentBadge tone={tone} size={34}>
                  {finding.investigator_id.slice(0, 2).toUpperCase()}
                </AgentBadge>
                <div className="flex flex-col grow min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip tone={tone}>{severityLabel(finding.severity)}</Chip>
                    <span className="mono text-fg-3" style={{ fontSize: 11 }}>
                      {finding.investigator_id} · opened {ago}
                      {investigation && investigation.tokens_input != null && (
                        <>
                          {' '}· {investigation.tokens_input.toLocaleString()}/
                          {(investigation.tokens_output ?? 0).toLocaleString()} tokens
                        </>
                      )}
                    </span>
                  </div>
                  <h2
                    style={{
                      margin: '6px 0 2px',
                      fontSize: 22,
                      letterSpacing: '-0.015em',
                      fontWeight: 600,
                    }}
                  >
                    {firstLine(finding.summary)}
                  </h2>
                  <p className="text-fg-2" style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
                    {tail(finding.summary)}
                  </p>
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <CloseLoopButton finding={finding} />
                  <button type="button" className="ds-btn sm">
                    Snooze
                  </button>
                </div>
              </div>

              {finding.evidence.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {uniqueEventSources(finding).map((s) => (
                    <Chip key={s}>
                      <span className="mono">{s}</span>
                    </Chip>
                  ))}
                  <Chip tone="blue">{finding.evidence.length} cited event(s)</Chip>
                </div>
              )}
            </CardBody>
          </Card>

          {/* reasoning trace (real agent_runs) */}
          {investigation && agentRuns.length > 0 ? (
            <Card>
              <CardHeader>
                <span className="font-semibold">Root Cause Agent · reasoning trace</span>
                <span className="mono text-fg-3 ml-auto" style={{ fontSize: 11 }}>
                  {agentRuns.length} hops ·{' '}
                  {investigation.tokens_input
                    ? `${investigation.tokens_input.toLocaleString()}in / ${(investigation.tokens_output ?? 0).toLocaleString()}out`
                    : '—'}
                </span>
              </CardHeader>
              <CardBody className="flex flex-col gap-1">
                {agentRuns.map((r) => {
                  const stateClass =
                    r.status === 'failed' ? 'failed' : r.status === 'running' ? 'live' : 'done';
                  return (
                    <div key={r.id} className={`reason ${stateClass}`}>
                      <span className="dot" />
                      <div className="flex flex-col">
                        <span style={{ fontSize: 13 }}>
                          {r.agent_name ?? r.agent_id}{' '}
                          <span className="text-fg-3" style={{ fontWeight: 400 }}>
                            · {kindFromAgent(r.agent_id)}
                          </span>
                        </span>
                        <small>
                          {r.provider} · {r.model}
                          {r.tokens_input != null && ` · ${r.tokens_input}in / ${r.tokens_output ?? 0}out`}
                          {r.error && ` · ${r.error.slice(0, 80)}`}
                        </small>
                      </div>
                    </div>
                  );
                })}

                <hr style={{ height: 1, background: 'var(--line)', border: 0, margin: '10px 0' }} />

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="uppercase-mini text-fg-3">Counter-factual</span>
                    <span style={{ fontSize: 12.5 }}>
                      Same context pre-spike — Argus saw no anomaly.
                    </span>
                  </div>
                  <span style={{ width: 1, height: 28, background: 'var(--line)' }} />
                  <div className="flex flex-col gap-1">
                    <span className="uppercase-mini text-fg-3">Memory referenced</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Chip tone="emerald" size="sm">
                        weekend re-stock
                      </Chip>
                      <Chip tone="blue" size="sm">
                        vendor risk v3
                      </Chip>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="text-fg-2" style={{ fontSize: 12.5 }}>
                Single-call investigation — no agent reasoning trail. Migrate this investigator to
                a pipeline (3+ agents) to see step-by-step reasoning here.
              </CardBody>
            </Card>
          )}

          {/* evidence */}
          <Card>
            <CardHeader>
              <span className="font-semibold">Evidence</span>
              <div className="ds-tabs ml-auto">
                <span className="ds-tab active">Pattern</span>
                <span className="ds-tab">Cited events</span>
                <span className="ds-tab">Diff</span>
              </div>
            </CardHeader>
            <CardBody>
              <EvidenceChart />
            </CardBody>
          </Card>

          {/* expandable detail — keeps the existing prompt + output drilldown */}
          {investigation && agentRuns.length > 0 && (
            <Card>
              <CardHeader>
                <span className="font-semibold">Per-agent prompts & outputs</span>
                <span className="mono text-fg-3 ml-auto" style={{ fontSize: 11 }}>
                  click to expand
                </span>
              </CardHeader>
              <CardBody>
                <ReasoningTimeline investigation={investigation} agentRuns={agentRuns} />
              </CardBody>
            </Card>
          )}
        </div>

        {/* right sidebar */}
        <div className="flex flex-col gap-3">
          {/* recommendation panel */}
          <Card>
            <CardHeader>
              <span className="font-semibold">Recommendation</span>
              <Chip tone={tone} size="sm" className="ml-auto">
                act today
              </Chip>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              {finding.recommendation ? (
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }} className="text-fg-1">
                  {finding.recommendation}
                </p>
              ) : (
                <p className="text-fg-2" style={{ margin: 0, fontSize: 12.5 }}>
                  No recommendation was emitted by the finding writer. Re-run the investigator
                  with an updated rubric.
                </p>
              )}

              {/* 3-step action plan derived from the finding */}
              <div className="flex flex-col gap-2">
                {[
                  ['1', 'Pause the root-cause source', 'evidence trace'],
                  ['2', 'Dispatch audit ticket', 'ops.tickets'],
                  ['3', 'Notify leads', 'slack · email'],
                ].map(([n, t, sub], i) => (
                  <div
                    key={n}
                    className="grid"
                    style={{
                      gridTemplateColumns: '22px 1fr',
                      gap: 10,
                      padding: '8px 0',
                      borderTop: i === 0 ? 0 : '1px solid var(--line)',
                    }}
                  >
                    <AgentBadge tone="blue">{n}</AgentBadge>
                    <div className="flex flex-col" style={{ lineHeight: 1.3 }}>
                      <span style={{ fontSize: 12.5 }}>{t}</span>
                      <span className="mono text-fg-3" style={{ fontSize: 10.5 }}>
                        {sub}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {finding.impact_estimate && (
                <div
                  style={{
                    padding: 10,
                    border: '1px dashed var(--line)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--fg-1)',
                    lineHeight: 1.5,
                  }}
                >
                  <div className="uppercase-mini text-fg-3 mb-1">Estimated impact</div>
                  <span
                    className="mono"
                    style={{ color: 'var(--emerald)', fontSize: 14, fontWeight: 600 }}
                  >
                    − {finding.impact_estimate.amount.toLocaleString()}{' '}
                    {finding.impact_estimate.currency}
                  </span>
                  <p
                    className="mono text-fg-3"
                    style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.5 }}
                  >
                    {finding.impact_estimate.basis}
                  </p>
                </div>
              )}

              <CloseLoopButton finding={finding} />
              <button type="button" className="ds-btn sm ghost">
                Save as investigator pattern…
              </button>
            </CardBody>
          </Card>

          {/* cited evidence list */}
          <Card>
            <CardHeader>
              <span className="font-semibold">
                Evidence ({finding.evidence.length} event{finding.evidence.length === 1 ? '' : 's'})
              </span>
            </CardHeader>
            <CardBody className="flex flex-col gap-2">
              {finding.evidence.length === 0 && (
                <p className="text-fg-3" style={{ margin: 0, fontSize: 12.5 }}>
                  No event_ids cited.
                </p>
              )}
              {finding.evidence.map((e) => (
                <div
                  key={e.event_id}
                  style={{
                    padding: 10,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    fontSize: 12.5,
                  }}
                >
                  <code
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      color: 'var(--blue)',
                      display: 'block',
                      wordBreak: 'break-all',
                    }}
                  >
                    {e.event_id}
                  </code>
                  <p className="text-fg-1" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
                    {e.reason}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function severityToTone(s: Finding['severity']): Tone {
  switch (s) {
    case 'critical':
    case 'high':
      return 'rose';
    case 'medium':
      return 'amber';
    case 'low':
      return 'blue';
    case 'none':
      return 'emerald';
  }
}

function severityLabel(s: Finding['severity']): string {
  switch (s) {
    case 'critical':
      return 'Critical · 99% confidence';
    case 'high':
      return 'Anomaly · 94% confidence';
    case 'medium':
      return 'Watch · forming';
    case 'low':
      return 'Info · low signal';
    case 'none':
      return 'Resolved · no issue';
  }
}

function firstLine(s: string): string {
  const idx = s.indexOf('.');
  if (idx === -1 || idx > 120) return s.slice(0, 120);
  return s.slice(0, idx + 1);
}

function tail(s: string): string {
  const idx = s.indexOf('.');
  if (idx === -1) return '';
  return s.slice(idx + 1).trim();
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function uniqueEventSources(f: Finding): string[] {
  // Best-effort: extract event_type prefixes from cited event_ids.
  const set = new Set<string>();
  for (const e of f.evidence) {
    // event_ids are opaque hashes; show the first 8 chars as a "source-ish" chip
    set.add(e.event_id.slice(0, 12));
    if (set.size >= 4) break;
  }
  return [...set];
}

function kindFromAgent(agentId: string): string {
  if (agentId.includes('evidence')) return 'evidence';
  if (agentId.includes('analyst')) return 'analysis';
  if (agentId.includes('writer') || agentId.includes('finding')) return 'finding';
  return 'agent';
}
