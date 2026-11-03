import Link from 'next/link'
import { loadCompany } from '@/lib/company'
import { Badge, ButtonLink, Card, Empty, Field, Flash, TextArea, when } from '@/components/ui'
import { SubmitButton } from '@/components/SubmitButton'
import { errorText, firstParam } from '@/lib/messages'
import type { CollectionRun, Objective, Report, Signal } from '@/lib/db-types'
import { confirmObjective, proposeAnother, runNow, setObjectiveStatus } from './actions'

export const metadata = { title: 'Overview' }

const OK: Record<string, string> = {
  confirmed: 'Objective confirmed. Argus will collect on its schedule, or run it now below.',
  ran: 'Run finished. See the run log below.',
}

export default async function Overview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { supabase, company } = await loadCompany(slug)

  const [{ data: objectives }, { count: sourceCount }, { data: connections }] = await Promise.all([
    supabase.from('objectives').select('*').eq('company_id', company.id).in('status', ['proposed', 'confirmed', 'paused']).order('created_at', { ascending: false }).returns<Objective[]>(),
    supabase.from('sources').select('id', { count: 'exact', head: true }).eq('company_id', company.id),
    supabase.from('connections').select('id, status').eq('company_id', company.id),
  ])
  const active = objectives?.find((o) => o.status !== 'proposed') ?? null
  const proposed = objectives?.find((o) => o.status === 'proposed') ?? null
  const hasFacebook = connections?.some((c) => c.status === 'active') ?? false

  const [{ data: runs }, { data: reports }, { data: signals }] = active
    ? await Promise.all([
        supabase.from('collection_runs').select('*').eq('objective_id', active.id).order('started_at', { ascending: false }).limit(5).returns<CollectionRun[]>(),
        supabase.from('reports').select('id, title, status, created_at').eq('objective_id', active.id).order('created_at', { ascending: false }).limit(3).returns<Pick<Report, 'id' | 'title' | 'status' | 'created_at'>[]>(),
        supabase.from('signals').select('*').eq('objective_id', active.id).order('created_at', { ascending: false }).limit(8).returns<Signal[]>(),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  const error = errorText(firstParam(sp.error))
  const ok = OK[firstParam(sp.ok) ?? '']

  return (
    <>
      {error && <Flash tone="bad">{error}</Flash>}
      {ok && <Flash tone="ok">{ok}</Flash>}

      {!hasFacebook && (
        <Flash tone="info">
          Connect your Facebook page so Argus has something to read.{' '}
          <Link href={`/c/${slug}/sources`} className="underline">
            Go to Sources
          </Link>
        </Flash>
      )}

      {proposed && <ProposalCard slug={slug} o={proposed} replacing={Boolean(active)} />}

      {active ? (
        <Card
          title={active.title}
          aside={<Badge tone={active.status === 'confirmed' ? 'ok' : 'warn'}>{active.status === 'confirmed' ? `${active.cadence}` : 'paused'}</Badge>}
        >
          <p className="text-muted">{active.description}</p>
          <ul className="mt-3 list-inside list-disc text-sm">
            {active.plan.watch?.map((w) => <li key={w}>{w}</li>)}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Last run {when(active.last_run_at)} · last report {when(active.last_report_at)} · {sourceCount ?? 0} sources
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <form action={runNow} className="flex items-center gap-3">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="objective_id" value={active.id} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="report" className="size-4" /> also write a report
              </label>
              <SubmitButton pendingLabel="Collecting…">Run now</SubmitButton>
            </form>
            <form action={setObjectiveStatus}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="objective_id" value={active.id} />
              <input type="hidden" name="status" value={active.status === 'confirmed' ? 'paused' : 'confirmed'} />
              <SubmitButton variant="secondary">{active.status === 'confirmed' ? 'Pause' : 'Resume'}</SubmitButton>
            </form>
            {!proposed && (
              <form action={proposeAnother}>
                <input type="hidden" name="slug" value={slug} />
                <SubmitButton variant="secondary" pendingLabel="Thinking…">
                  Propose another objective
                </SubmitButton>
              </form>
            )}
          </div>
        </Card>
      ) : (
        !proposed && (
          <Card title="No objective yet">
            <form action={proposeAnother}>
              <input type="hidden" name="slug" value={slug} />
              <SubmitButton pendingLabel="Thinking…">Let Argus propose one</SubmitButton>
            </form>
          </Card>
        )
      )}

      {active && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Latest signals" aside={<span className="text-xs text-muted">kept after the filter</span>}>
            {signals?.length ? (
              <ul className="space-y-3">
                {signals.map((s) => (
                  <li key={s.id} className="text-sm">
                    <span className="mr-2">
                      <Badge tone={s.importance >= 4 ? 'warn' : 'muted'}>{s.kind}</Badge>
                    </span>
                    {s.summary}
                    <span className="block text-xs text-muted">{s.reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No signals yet. Run the objective once your sources are connected.</Empty>
            )}
          </Card>

          <div className="space-y-6">
            <Card title="Reports" aside={<Link href={`/c/${slug}/reports`} className="text-sm text-accent underline">All</Link>}>
              {reports?.length ? (
                <ul className="space-y-2">
                  {reports.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                      <Link href={`/c/${slug}/reports/${r.id}`} className="underline">
                        {r.title}
                      </Link>
                      <Badge tone={r.status === 'verified' ? 'ok' : 'bad'}>{r.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>The first report is written after the first signals, then weekly.</Empty>
              )}
            </Card>

            <Card title="Runs">
              {runs?.length ? (
                <ul className="space-y-3 text-sm">
                  {runs.map((r) => (
                    <li key={r.id}>
                      <div className="flex items-center justify-between gap-3">
                        <span>
                          {when(r.started_at)} · {r.trigger}
                        </span>
                        <Badge tone={r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'bad' : r.status === 'running' ? 'info' : 'warn'}>{r.status}</Badge>
                      </div>
                      <p className="text-xs text-muted">
                        {r.items_seen} seen · {r.items_new} new · {r.items_kept} kept
                      </p>
                      {r.log.length > 0 && (
                        <details className="text-xs text-muted">
                          <summary className="cursor-pointer">log</summary>
                          <ul className="mt-1 list-inside list-disc">
                            {r.log.map((l, i) => (
                              <li key={i}>{l.msg}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No run yet.</Empty>
              )}
            </Card>
          </div>
        </div>
      )}

      {!active && !proposed && (
        <ButtonLink href={`/c/${slug}/sources`} variant="secondary">
          Set up sources
        </ButtonLink>
      )}
    </>
  )
}

function ProposalCard({ slug, o, replacing }: { slug: string; o: Objective; replacing: boolean }) {
  return (
    <Card
      title={o.proposed_by === 'ai' ? 'Argus proposes this objective' : 'Suggested objective'}
      aside={<Badge tone="info">{o.proposed_by === 'ai' ? 'proposed by AI' : 'default'}</Badge>}
      className="border-accent"
    >
      <p className="mb-4 text-sm text-muted">
        Nothing is collected until you confirm. Edit anything first. {replacing && 'Confirming replaces the current objective.'}
      </p>
      <form action={confirmObjective} className="space-y-4">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="objective_id" value={o.id} />
        <Field label="Objective" name="title" defaultValue={o.title} required minLength={3} maxLength={140} />
        <TextArea label="What Argus will look for" name="description" defaultValue={o.description} rows={3} maxLength={1000} />
        <div>
          <span className="mb-1 block text-sm font-medium">It will watch</span>
          <ul className="list-inside list-disc text-sm">
            {o.plan.watch?.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
        <Field
          label="Ad Library searches"
          name="ad_library_terms"
          defaultValue={(o.plan.ad_library_terms ?? []).join(', ')}
          hint="Comma separated, up to 5. Each becomes a source that reads ads running in your country."
        />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">How often</span>
          <select name="cadence" defaultValue={o.cadence} className="min-h-11 rounded-md border border-line bg-white px-3">
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          <SubmitButton pendingLabel="Confirming…">Confirm and start</SubmitButton>
        </div>
      </form>
      <div className="mt-3 flex gap-3">
        <form action={proposeAnother}>
          <input type="hidden" name="slug" value={slug} />
          <SubmitButton variant="secondary" pendingLabel="Thinking…">
            Something else
          </SubmitButton>
        </form>
        <form action={setObjectiveStatus}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="objective_id" value={o.id} />
          <input type="hidden" name="status" value="dismissed" />
          <SubmitButton variant="danger">Dismiss</SubmitButton>
        </form>
      </div>
    </Card>
  )
}
