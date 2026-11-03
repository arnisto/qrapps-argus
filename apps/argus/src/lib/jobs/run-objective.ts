import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, fromHex } from '@/lib/crypto'
import { hasGeminiKey } from '@/lib/ai/gemini'
import { filterBatch, prefilter, type FilterItem } from '@/lib/ai/filter-signals'
import { critic, renderMarkdown, writeReport, type ReportSignal } from '@/lib/ai/report'
import { GraphClient, MetaError, adLibrary, listPages, pagePosts, type CollectedItem } from '@/lib/meta/graph'
import { publicContentApproved } from '@/lib/meta/flags'
import type { Company, Connection, Objective, Source } from '@/lib/db-types'

const FILTER_BATCH = 20
const REPORT_EVERY_MS = 7 * 24 * 3600 * 1000

export interface RunResult {
  runId: string
  status: 'ok' | 'partial' | 'failed'
  itemsSeen: number
  itemsNew: number
  itemsKept: number
  reportId: string | null
}

/** Is a confirmed objective due for a cron run? Daily = 20 h gap (tolerates cron drift), weekly = 6.5 days. */
export function isDue(o: Pick<Objective, 'status' | 'cadence' | 'last_run_at'>, now = new Date()): boolean {
  if (o.status !== 'confirmed') return false
  if (!o.last_run_at) return true
  const gap = o.cadence === 'daily' ? 20 * 3600 * 1000 : 6.5 * 24 * 3600 * 1000
  return now.getTime() - new Date(o.last_run_at).getTime() >= gap
}

export function isReportDue(o: Pick<Objective, 'last_report_at'>, now = new Date()): boolean {
  return !o.last_report_at || now.getTime() - new Date(o.last_report_at).getTime() >= REPORT_EVERY_MS
}

/**
 * One full pass for one objective: collect from every active source, keep new items, filter them into signals,
 * and write a report when one is due (or forced). Uses the service-role client: call only from server code that
 * already checked the caller (cron secret, or session membership for a manual run).
 */
export async function runObjective(
  db: SupabaseClient,
  objectiveId: string,
  opts: { trigger: 'cron' | 'manual'; forceReport?: boolean },
): Promise<RunResult> {
  const { data: objective, error: oErr } = await db.from('objectives').select('*').eq('id', objectiveId).single<Objective>()
  if (oErr || !objective) throw new Error(`objective ${objectiveId} not found`)
  const { data: company } = await db.from('companies').select('*').eq('id', objective.company_id).single<Company>()
  if (!company) throw new Error('company not found')

  const { data: run } = await db
    .from('collection_runs')
    .insert({ company_id: company.id, objective_id: objective.id, trigger: opts.trigger })
    .select('id')
    .single<{ id: string }>()
  if (!run) throw new Error('could not create run')

  const log: Array<{ at: string; msg: string }> = []
  const note = (msg: string) => log.push({ at: new Date().toISOString(), msg })
  let status: RunResult['status'] = 'ok'
  let itemsSeen = 0
  let llmTokens = 0
  const fresh: Array<FilterItem & { rawId: string }> = []

  try {
    const { data: connections } = await db
      .from('connections')
      .select('*')
      .eq('company_id', company.id)
      .eq('provider', 'meta')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .returns<Connection[]>()
    const connection = connections?.[0]
    const { data: sources } = await db.from('sources').select('*').eq('company_id', company.id).returns<Source[]>()

    if (!connection) {
      note('no active Facebook connection: connect one on the Sources page')
      status = 'partial'
    } else {
      const userToken = decrypt(fromHex(connection.token_ct), fromHex(connection.token_iv))
      const user = new GraphClient(userToken)
      let pageTokens: Map<string, string> | null = null

      for (const source of sources ?? []) {
        if (source.status === 'pending_review' && !publicContentApproved()) {
          note(`${source.name}: waiting for Meta App Review (Page Public Content Access)`)
          continue
        }
        if (source.status === 'paused') continue
        try {
          let items: CollectedItem[] = []
          const since = source.cursor ? new Date(source.cursor) : null
          if (source.kind === 'own_page') {
            pageTokens ??= new Map((await listPages(user)).filter((p) => p.access_token).map((p) => [p.id, p.access_token!]))
            const token = pageTokens.get(source.external_id)
            if (!token) throw new MetaError('page not in this Facebook account any more', 'permission', null)
            items = await pagePosts(new GraphClient(token), source.external_id, since)
          } else if (source.kind === 'public_page') {
            items = await pagePosts(user, source.external_id, since)
          } else {
            items = await adLibrary(user, source.external_id, company.country)
          }
          itemsSeen += items.length

          if (items.length) {
            const { data: inserted, error } = await db
              .from('raw_items')
              .upsert(
                items.map((it) => ({
                  company_id: company.id,
                  source_id: source.id,
                  run_id: run.id,
                  external_id: it.external_id,
                  kind: it.kind,
                  text: it.text,
                  metrics: it.metrics,
                  url: it.url,
                  posted_at: it.posted_at,
                  payload: it.payload,
                })),
                { onConflict: 'source_id,external_id', ignoreDuplicates: true },
              )
              .select('id, external_id, kind, text, metrics, posted_at')
            if (error) throw new Error(error.message)
            for (const r of inserted ?? []) {
              fresh.push({ rawId: r.id, id: r.id, source_name: source.name, kind: r.kind, text: r.text, metrics: r.metrics, posted_at: r.posted_at })
            }
          }

          const newest = items.map((i) => i.posted_at).filter((d): d is string => Boolean(d)).sort().at(-1)
          await db
            .from('sources')
            .update({ status: 'active', last_error: null, ...(newest && source.kind !== 'ad_library_query' ? { cursor: newest } : {}) })
            .eq('id', source.id)
          note(`${source.name}: ${items.length} items`)
        } catch (e) {
          status = 'partial'
          const err = e instanceof MetaError ? e : null
          note(`${source.name}: ${err ? err.kind : 'error'} ${(e as Error).message}`)
          if (err?.kind === 'auth') {
            await db.from('connections').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', connection.id)
            note('Facebook token expired: reconnect on the Sources page')
            break
          }
          const nextStatus = err?.kind === 'permission' && source.kind === 'public_page' ? 'pending_review' : 'error'
          await db.from('sources').update({ status: nextStatus, last_error: (e as Error).message.slice(0, 500) }).eq('id', source.id)
          if (err?.kind === 'rate_limited') break
        }
      }
    }

    // ---- filter
    let itemsKept = 0
    if (fresh.length && !hasGeminiKey()) {
      note('GEMINI_API_KEY not set: items stored, not filtered')
      status = 'partial'
    } else if (fresh.length) {
      const { kept, dropped } = prefilter(fresh)
      note(`prefilter dropped ${dropped.length} of ${fresh.length}`)
      for (let i = 0; i < kept.length; i += FILTER_BATCH) {
        const batch = kept.slice(i, i + FILTER_BATCH)
        const { verdicts, tokens } = await filterBatch(
          { title: objective.title, description: objective.description, signal_kinds: objective.plan.signal_kinds ?? [] },
          batch,
        )
        llmTokens += tokens
        const rows = verdicts
          .filter((v) => v.keep)
          .map((v) => ({
            company_id: company.id,
            objective_id: objective.id,
            run_id: run.id,
            raw_item_id: v.id,
            kind: v.kind,
            summary: v.summary,
            value: { numbers: v.numbers, entities: v.entities },
            importance: v.importance,
            reason: v.reason,
          }))
        if (rows.length) {
          const { error } = await db.from('signals').upsert(rows, { onConflict: 'objective_id,raw_item_id', ignoreDuplicates: true })
          if (error) throw new Error(error.message)
          itemsKept += rows.length
        }
      }
    }

    // ---- report
    let reportId: string | null = null
    if (hasGeminiKey() && (opts.forceReport || isReportDue(objective))) {
      const r = await buildReport(db, company, objective)
      reportId = r.reportId
      llmTokens += r.tokens
      note(r.reportId ? `report ${r.status}` : 'no signals yet: no report')
    }

    await db
      .from('collection_runs')
      .update({ status, finished_at: new Date().toISOString(), items_seen: itemsSeen, items_new: fresh.length, items_kept: itemsKept, llm_tokens: llmTokens, log })
      .eq('id', run.id)
    await db.from('objectives').update({ last_run_at: new Date().toISOString() }).eq('id', objective.id)
    return { runId: run.id, status, itemsSeen, itemsNew: fresh.length, itemsKept, reportId }
  } catch (e) {
    note(`failed: ${(e as Error).message}`)
    await db
      .from('collection_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), items_seen: itemsSeen, items_new: fresh.length, llm_tokens: llmTokens, log, error: (e as Error).message.slice(0, 1000) })
      .eq('id', run.id)
    return { runId: run.id, status: 'failed', itemsSeen, itemsNew: fresh.length, itemsKept: 0, reportId: null }
  }
}

async function buildReport(
  db: SupabaseClient,
  company: Company,
  objective: Objective,
): Promise<{ reportId: string | null; status: 'verified' | 'failed' | null; tokens: number }> {
  const end = new Date()
  const start = objective.last_report_at ? new Date(objective.last_report_at) : new Date(end.getTime() - REPORT_EVERY_MS)
  const { data: rows } = await db
    .from('signals')
    .select('id, kind, summary, value, importance, created_at, raw_items(source_id, sources(name))')
    .eq('objective_id', objective.id)
    .gte('created_at', start.toISOString())
    .order('importance', { ascending: false })
    .limit(60)
  if (!rows?.length) return { reportId: null, status: null, tokens: 0 }

  const signals: ReportSignal[] = rows.map((r) => {
    const raw = r.raw_items as unknown as { sources?: { name?: string } } | null
    const value = r.value as { numbers?: Record<string, number>; entities?: string[] }
    return {
      id: r.id as string,
      kind: r.kind as string,
      summary: r.summary as string,
      numbers: value.numbers ?? {},
      entities: value.entities ?? [],
      importance: r.importance as number,
      source_name: raw?.sources?.name ?? 'unknown source',
      created_at: r.created_at as string,
    }
  })

  const period = `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`
  const { report, tokens } = await writeReport({ company: company.name, objective: objective.title, period }, signals)
  const problems = critic(report, signals)
  const status = problems.length ? 'failed' : 'verified'
  const { data: saved } = await db
    .from('reports')
    .insert({
      company_id: company.id,
      objective_id: objective.id,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      title: report.title,
      body_md: renderMarkdown(report, signals),
      evidence: { report, signal_ids: signals.map((s) => s.id) },
      status,
      critic: problems,
    })
    .select('id')
    .single<{ id: string }>()
  if (status === 'verified') await db.from('objectives').update({ last_report_at: end.toISOString() }).eq('id', objective.id)
  return { reportId: saved?.id ?? null, status, tokens }
}
