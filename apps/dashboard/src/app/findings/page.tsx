import Link from 'next/link';
import { api, type Finding } from '@/lib/api';
import { Card, CardHeader, CardBody } from '@/components/ds/Card';
import { Chip, AgentBadge } from '@/components/ds/Chip';
import type { Tone } from '@/components/ds/Chip';

export const dynamic = 'force-dynamic';

/**
 * Findings list — the "Loops" / archive view. The Today page surfaces the 4
 * most recent in a richer card layout; this page is the full log.
 */
export default async function FindingsListPage() {
  let findings: Finding[] = [];
  let error: string | null = null;
  try {
    const res = await api<{ findings: Finding[] }>('/v1/findings?limit=50');
    findings = res.findings;
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
        <p className="text-fg-2 mt-1" style={{ fontSize: 13 }}>
          Everything Argus has investigated, most recent first. Click any row to open the full
          reasoning trail + close-the-loop flow.
        </p>
      </div>

      {error ? (
        <Card>
          <CardBody className="text-rose" style={{ fontSize: 13 }}>
            API unreachable: <code className="mono">{error}</code>
          </CardBody>
        </Card>
      ) : findings.length === 0 ? (
        <Card>
          <CardBody className="text-center" style={{ padding: 40 }}>
            <h2 className="font-medium" style={{ fontSize: 16 }}>
              No findings yet
            </h2>
            <p className="text-fg-2 mt-2" style={{ fontSize: 13 }}>
              Connect a data source and Argus will start investigating —{' '}
              <Link className="text-blue hover:underline" href="/connectors">
                Connectors
              </Link>
              .
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {findings.map((f) => (
            <li key={f.id}>
              <Link href={`/findings/${f.id}`} className={`find ${toneFor(f.severity)}`}>
                <div className="sev" />
                <AgentBadge tone={toneFor(f.severity)}>
                  {f.investigator_id.slice(0, 2).toUpperCase()}
                </AgentBadge>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <Chip tone={toneFor(f.severity)} size="sm">
                      {f.severity}
                    </Chip>
                    <span className="mono text-fg-3" style={{ fontSize: 11 }}>
                      {f.investigator_id}
                    </span>
                  </div>
                  <p
                    className="text-fg-1"
                    style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 }}
                  >
                    {f.summary}
                  </p>
                </div>
                <div className="flex flex-col items-end whitespace-nowrap">
                  <span className="uppercase-mini text-fg-3">When</span>
                  <span className="mono text-fg-2" style={{ fontSize: 11 }}>
                    {new Date(f.created_at).toLocaleString()}
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

function toneFor(s: Finding['severity']): Tone {
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
