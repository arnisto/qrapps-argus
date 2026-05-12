import Link from 'next/link';
import type { Finding } from '@/lib/api';
import { Card, CardHeader, CardBody } from './Card';
import { Chip, AgentBadge } from './Chip';
import type { Tone } from './Chip';

interface Props {
  findings: Finding[];
}

/**
 * News-feed style finding cards from Screen 1. Each card is a tone-coded row
 * (severity → tone) with a left-rail accent bar, an agent badge, the finding
 * summary, a primary CTA, and an "Impact" cell on the right.
 *
 * The CTA wording adapts to severity: actively dangerous = "Approve audit",
 * neutral/positive = "Show details". Both link to the finding detail page
 * which has the close-the-loop modal.
 */
export function IntelligenceFeed({ findings }: Props) {
  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">Intelligence feed</span>
        <div className="ds-tabs ml-auto">
          <span className="ds-tab active">
            All{' '}
            <span className="mono text-fg-3" style={{ fontSize: 11 }}>
              {findings.length}
            </span>
          </span>
          <span className="ds-tab">
            <span style={{ color: 'var(--rose)' }}>●</span> Risks
          </span>
          <span className="ds-tab">
            <span style={{ color: 'var(--emerald)' }}>●</span> Opportunities
          </span>
          <span className="ds-tab">
            <span style={{ color: 'var(--blue)' }}>●</span> Learnings
          </span>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3" style={{ paddingBottom: 14 }}>
        {findings.length === 0 && (
          <div className="text-fg-3" style={{ padding: '24px 8px', fontSize: 13 }}>
            No findings yet — Argus is watching. Once your connectors land events that match an
            investigator&apos;s triggers, the feed populates here.
          </div>
        )}
        {findings.map((f) => (
          <FindingRow key={f.id} f={f} />
        ))}
      </CardBody>
    </Card>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const tone: Tone = severityToTone(f.severity);
  const isDanger = f.severity === 'critical' || f.severity === 'high';
  const cta = isDanger ? 'Approve audit' : f.severity === 'none' ? 'Acknowledge' : 'Open finding';
  const ago = relativeTime(f.created_at);

  return (
    <Link href={`/findings/${f.id}`} className={`find ${tone}`}>
      <div className="sev" />
      <AgentBadge tone={tone}>{investigatorInitials(f.investigator_id)}</AgentBadge>
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <Chip tone={tone}>{severityBadge(f.severity)}</Chip>
          <span className="mono text-fg-3" style={{ fontSize: 11 }}>
            · {ago}
          </span>
          <span className="mono text-fg-3" style={{ fontSize: 11 }}>
            · {f.investigator_id}
          </span>
        </div>
        <h4
          style={{
            margin: '4px 0 2px',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '-0.005em',
          }}
        >
          {firstLine(f.summary)}
        </h4>
        <p className="text-fg-2" style={{ margin: 0, fontSize: 12.5 }}>
          {tail(f.summary)}
        </p>
        <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
          <span
            className={`ds-btn sm ${tone === 'rose' ? 'primary' : tone === 'emerald' ? 'success' : ''}`}
          >
            {cta}
          </span>
          <span className="ds-btn sm ghost">Show root cause →</span>
        </div>
      </div>
      <div className="flex flex-col items-end whitespace-nowrap">
        <span className="uppercase-mini text-fg-3">Impact</span>
        <span
          className="mono"
          style={{ fontSize: 13, color: `var(--${tone})`, fontWeight: 600 }}
        >
          {impactLabel(f)}
        </span>
      </div>
    </Link>
  );
}

function severityToTone(s: Finding['severity']): Tone {
  switch (s) {
    case 'critical':
      return 'rose';
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

function severityBadge(s: Finding['severity']): string {
  switch (s) {
    case 'critical':
      return 'Critical · act now';
    case 'high':
      return 'Anomaly · high confidence';
    case 'medium':
      return 'Watch · forming';
    case 'low':
      return 'Info · low signal';
    case 'none':
      return 'Resolved · no issue';
  }
}

function impactLabel(f: Finding): string {
  if (f.impact_estimate) {
    return `${f.impact_estimate.amount.toLocaleString()} ${f.impact_estimate.currency}`;
  }
  return f.severity === 'none' ? '—' : 'TBD';
}

function investigatorInitials(id: string): string {
  const parts = id.split(/[-_]/);
  if (parts.length === 1) return id.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function firstLine(s: string): string {
  const idx = s.indexOf('.');
  if (idx === -1 || idx > 90) return s.slice(0, 90);
  return s.slice(0, idx + 1);
}

function tail(s: string): string {
  const idx = s.indexOf('.');
  if (idx === -1) return '';
  return s
    .slice(idx + 1)
    .trim()
    .slice(0, 180);
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
