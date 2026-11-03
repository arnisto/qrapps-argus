import { loadCompany } from '@/lib/company'
import { Badge, ButtonAnchor, Card, Empty, Field, Flash, when } from '@/components/ui'
import { SubmitButton } from '@/components/SubmitButton'
import { errorText, firstParam } from '@/lib/messages'
import { publicContentApproved } from '@/lib/meta/flags'
import type { Connection, Source } from '@/lib/db-types'
import { addAdQuery, addCompetitorPage, disconnectFacebook, removeSource, toggleSource } from '../actions'

export const metadata = { title: 'Sources' }

const KIND_LABEL: Record<Source['kind'], string> = {
  own_page: 'Your page',
  public_page: 'Competitor page',
  ad_library_query: 'Ad Library search',
}

const STATUS_TONE = { active: 'ok', pending_review: 'warn', paused: 'muted', error: 'bad' } as const
const STATUS_LABEL = { active: 'active', pending_review: 'waiting for Meta review', paused: 'paused', error: 'error' } as const

export default async function SourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { supabase, company } = await loadCompany(slug)
  const [{ data: connections }, { data: sources }] = await Promise.all([
    supabase.from('connections').select('id, external_name, status, expires_at, created_at').eq('company_id', company.id).returns<Connection[]>(),
    supabase.from('sources').select('*').eq('company_id', company.id).order('kind').order('created_at').returns<Source[]>(),
  ])
  const error = errorText(firstParam(sp.error))
  const connected = firstParam(sp.connected)
  const facebook = connections?.[0]

  return (
    <>
      <h1 className="text-2xl font-semibold">Sources</h1>
      {error && <Flash tone="bad">{error}</Flash>}
      {connected !== undefined && <Flash tone="ok">Facebook connected. {connected} page(s) added as sources.</Flash>}
      {firstParam(sp.ok) === 'added' && <Flash tone="ok">Source added.</Flash>}

      <Card title="Facebook account">
        {facebook ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{facebook.external_name ?? 'Facebook account'}</span>
            <Badge tone={facebook.status === 'active' ? 'ok' : 'bad'}>{facebook.status}</Badge>
            <span className="text-sm text-muted">token valid until {when(facebook.expires_at)}</span>
            <ButtonAnchor href={`/api/meta/start?company=${slug}`} variant="secondary">
              Reconnect
            </ButtonAnchor>
            <form action={disconnectFacebook}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="connection_id" value={facebook.id} />
              <SubmitButton variant="danger">Disconnect</SubmitButton>
            </form>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Argus uses Meta&apos;s official API with read-only permissions: your pages, their posts and reactions, and the public Ad
              Library. It never posts and never scrapes.
            </p>
            <ButtonAnchor href={`/api/meta/start?company=${slug}`}>
              Connect Facebook
            </ButtonAnchor>
          </div>
        )}
      </Card>

      <Card title="What Argus reads">
        {sources?.length ? (
          <ul className="divide-y divide-line">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <span className="block font-medium">{s.name}</span>
                  <span className="block text-xs text-muted">
                    {KIND_LABEL[s.kind]} · collected up to {when(s.cursor)}
                    {s.last_error && <span className="text-bad"> · {s.last_error}</span>}
                  </span>
                </div>
                <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                <form action={toggleSource}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="source_id" value={s.id} />
                  <SubmitButton variant="secondary">{s.status === 'paused' ? 'Resume' : 'Pause'}</SubmitButton>
                </form>
                <form action={removeSource}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="source_id" value={s.id} />
                  <SubmitButton variant="danger">Remove</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No sources yet. Connect Facebook, or add a competitor or an ad search below.</Empty>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Watch a competitor page">
          {!publicContentApproved() && (
            <p className="mb-3 text-sm text-warn">
              Reading other pages needs Meta&apos;s Page Public Content Access, granted after App Review. Pages you add now wait in
              &quot;waiting for Meta review&quot; and start automatically once it is approved.
            </p>
          )}
          <form action={addCompetitorPage} className="space-y-3">
            <input type="hidden" name="slug" value={slug} />
            <Field label="Page link or id" name="page" placeholder="https://www.facebook.com/PadelArenaTunis" required />
            <Field label="Name (optional)" name="name" placeholder="Padel Arena" />
            <SubmitButton variant="secondary">Add page</SubmitButton>
          </form>
        </Card>

        <Card title="Search the Ad Library">
          <p className="mb-3 text-sm text-muted">
            Ads running in {company.country} that match these words, if Meta&apos;s Ad Library covers commercial ads in your country (outside
            the EU it may return only political and issue ads). Your Facebook account must have completed Meta&apos;s identity confirmation.
          </p>
          <form action={addAdQuery} className="space-y-3">
            <input type="hidden" name="slug" value={slug} />
            <Field label="Search terms" name="terms" placeholder="padel tunis" required minLength={2} maxLength={60} />
            <SubmitButton variant="secondary">Add search</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  )
}
