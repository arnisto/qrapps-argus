import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadCompany } from '@/lib/company'
import { Badge, Card, Flash, when } from '@/components/ui'
import type { StructuredReport } from '@/lib/ai/report'
import type { Report, Signal } from '@/lib/db-types'

export const metadata = { title: 'Report' }

interface SignalWithSource extends Signal {
  raw_items: { url: string | null; sources: { name: string } | null } | null
}

export default async function ReportPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const { supabase, company } = await loadCompany(slug)
  const { data: report } = await supabase.from('reports').select('*').eq('id', id).eq('company_id', company.id).maybeSingle<Report>()
  if (!report) notFound()

  const evidence = report.evidence as { report?: StructuredReport; signal_ids?: string[] }
  const ids = evidence.signal_ids ?? []
  const { data: signals } = ids.length
    ? await supabase.from('signals').select('*, raw_items(url, sources(name))').in('id', ids).returns<SignalWithSource[]>()
    : { data: [] as SignalWithSource[] }
  const ordered = ids.map((sid) => signals?.find((s) => s.id === sid)).filter((s): s is SignalWithSource => Boolean(s))
  const number = new Map(ids.map((sid, i) => [sid, i + 1]))
  const structured = evidence.report

  const cite = (sids: string[]) =>
    sids.map((sid) => (
      <a key={sid} href={`#ev-${number.get(sid)}`} className="ml-1 text-xs text-accent no-underline">
        [{number.get(sid) ?? '?'}]
      </a>
    ))

  return (
    <>
      <p className="text-sm">
        <Link href={`/c/${slug}/reports`} className="text-accent underline">
          Reports
        </Link>
      </p>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{report.title}</h1>
          <Badge tone={report.status === 'verified' ? 'ok' : 'bad'}>{report.status === 'verified' ? 'every number checked' : 'failed the check'}</Badge>
        </div>
        <p className="text-sm text-muted">
          {when(report.period_start)} to {when(report.period_end)} · {ordered.length} signals
        </p>
      </header>

      {report.status === 'failed' && (
        <Flash tone="bad">
          The checker found claims not backed by the evidence, so this report is not trusted. Problems:{' '}
          {report.critic.map((p) => p.detail).join('; ')}
        </Flash>
      )}

      {structured ? (
        <Card>
          <p className="mb-4">{structured.summary}</p>
          {structured.sections.map((s) => (
            <section key={s.heading} className="mb-4">
              <h2 className="mb-2 font-semibold">{s.heading}</h2>
              <ul className="list-inside list-disc space-y-1">
                {s.claims.map((c, i) => (
                  <li key={i}>
                    {c.text}
                    {cite(c.signal_ids)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {structured.actions.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">What to do next</h2>
              <ol className="list-inside list-decimal space-y-1">
                {structured.actions.map((a, i) => (
                  <li key={i}>
                    {a.text}
                    {cite(a.signal_ids)}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </Card>
      ) : (
        <Card>
          <pre className="whitespace-pre-wrap text-sm">{report.body_md}</pre>
        </Card>
      )}

      <Card title="Evidence">
        <ol className="space-y-3">
          {ordered.map((s, i) => (
            <li key={s.id} id={`ev-${i + 1}`} className="text-sm">
              <span className="mr-2 font-medium">[{i + 1}]</span>
              <Badge>{s.kind}</Badge> <span className="text-muted">{s.raw_items?.sources?.name ?? 'source'}</span>
              <p>{s.summary}</p>
              {Object.keys(s.value.numbers ?? {}).length > 0 && (
                <p className="text-xs text-muted">
                  {Object.entries(s.value.numbers ?? {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </p>
              )}
              {s.raw_items?.url && (
                <a href={s.raw_items.url} target="_blank" rel="noreferrer noopener" className="text-xs text-accent underline">
                  open on Facebook
                </a>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </>
  )
}
