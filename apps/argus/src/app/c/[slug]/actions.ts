'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { proposeObjective } from '@/lib/ai/propose-objective'
import { parsePageRef } from '@/lib/meta/graph'
import { runObjective } from '@/lib/jobs/run-objective'
import { publicContentApproved } from '@/lib/meta/flags'
import type { Company, Objective, Source } from '@/lib/db-types'

async function companyFor(slug: string) {
  const supabase = await createClient()
  const { data: company } = await supabase.from('companies').select('*').eq('slug', slug).maybeSingle<Company>()
  if (!company) redirect('/companies')
  return { supabase, company }
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

// ---------------------------------------------------------------- objectives

export async function confirmObjective(formData: FormData) {
  const slug = str(formData, 'slug')
  const { supabase, company } = await companyFor(slug)
  const id = str(formData, 'objective_id')
  const title = str(formData, 'title')
  const description = str(formData, 'description').slice(0, 1000)
  const cadence = str(formData, 'cadence') === 'weekly' ? 'weekly' : 'daily'
  const terms = str(formData, 'ad_library_terms')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 60)
    .slice(0, 5)
  if (title.length < 3 || title.length > 140) redirect(`/c/${slug}?error=objective_title`)

  const { data: objective } = await supabase.from('objectives').select('*').eq('id', id).eq('company_id', company.id).maybeSingle<Objective>()
  if (!objective) redirect(`/c/${slug}?error=objective_missing`)

  const {
    data: { user },
  } = await supabase.auth.getUser()
  // v1 runs one objective per company: confirming a new one retires the previous one.
  await supabase.from('objectives').update({ status: 'dismissed' }).eq('company_id', company.id).in('status', ['confirmed', 'paused']).neq('id', id)
  await supabase
    .from('objectives')
    .update({
      title,
      description,
      cadence,
      plan: { ...objective.plan, ad_library_terms: terms },
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: user?.id ?? null,
    })
    .eq('id', id)

  // The AI's ad library search terms become sources the moment the owner confirms.
  if (terms.length) {
    await supabase.from('sources').upsert(
      terms.map((t) => ({ company_id: company.id, kind: 'ad_library_query', external_id: t.toLowerCase(), name: `Ads: "${t}"`, status: 'active' })),
      { onConflict: 'company_id,kind,external_id', ignoreDuplicates: true },
    )
  }
  revalidatePath(`/c/${slug}`)
  redirect(`/c/${slug}?ok=confirmed`)
}

export async function setObjectiveStatus(formData: FormData) {
  const slug = str(formData, 'slug')
  const { supabase, company } = await companyFor(slug)
  const status = str(formData, 'status')
  if (!['paused', 'confirmed', 'dismissed'].includes(status)) redirect(`/c/${slug}`)
  await supabase.from('objectives').update({ status }).eq('id', str(formData, 'objective_id')).eq('company_id', company.id)
  revalidatePath(`/c/${slug}`)
  redirect(`/c/${slug}`)
}

export async function proposeAnother(formData: FormData) {
  const slug = str(formData, 'slug')
  const { supabase, company } = await companyFor(slug)
  const { data: sources } = await supabase.from('sources').select('kind, name').eq('company_id', company.id)
  const { proposal, by } = await proposeObjective({
    name: company.name,
    description: company.description,
    country: company.country,
    city: company.city,
    sources: sources ?? [],
  })
  await supabase.from('objectives').update({ status: 'dismissed' }).eq('company_id', company.id).eq('status', 'proposed')
  await supabase.from('objectives').insert({
    company_id: company.id,
    title: proposal.title,
    description: proposal.description,
    plan: { watch: proposal.watch, signal_kinds: proposal.signal_kinds, ad_library_terms: proposal.ad_library_terms },
    cadence: proposal.cadence,
    status: 'proposed',
    proposed_by: by,
  })
  revalidatePath(`/c/${slug}`)
  redirect(`/c/${slug}`)
}

export async function runNow(formData: FormData) {
  const slug = str(formData, 'slug')
  const { supabase, company } = await companyFor(slug)
  const id = str(formData, 'objective_id')
  // Membership is proven by RLS returning the row; only then does the service role act.
  const { data: objective } = await supabase.from('objectives').select('id').eq('id', id).eq('company_id', company.id).maybeSingle()
  if (!objective) redirect(`/c/${slug}?error=objective_missing`)
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) redirect(`/c/${slug}?error=no_service_key`)
  const result = await runObjective(createAdminClient(), id, { trigger: 'manual', forceReport: formData.get('report') === 'on' })
  revalidatePath(`/c/${slug}`)
  if (result.reportId) redirect(`/c/${slug}/reports/${result.reportId}`)
  redirect(result.status === 'failed' ? `/c/${slug}?error=run_failed` : `/c/${slug}?ok=ran`)
}

// ---------------------------------------------------------------- sources

export async function addCompetitorPage(formData: FormData) {
  const slug = str(formData, 'slug')
  const { supabase, company } = await companyFor(slug)
  const ref = parsePageRef(str(formData, 'page'))
  if (!ref) redirect(`/c/${slug}/sources?error=page_ref`)
  const name = str(formData, 'name') || ref
  const { error } = await supabase.from('sources').insert({
    company_id: company.id,
    kind: 'public_page',
    external_id: ref,
    name,
    status: publicContentApproved() ? 'active' : 'pending_review',
  })
  if (error) redirect(`/c/${slug}/sources?error=source_save`)
  revalidatePath(`/c/${slug}/sources`)
  redirect(`/c/${slug}/sources?ok=added`)
}

export async function addAdQuery(formData: FormData) {
  const slug = str(formData, 'slug')
  const { supabase, company } = await companyFor(slug)
  const terms = str(formData, 'terms')
  if (terms.length < 2 || terms.length > 60) redirect(`/c/${slug}/sources?error=ad_terms`)
  const { error } = await supabase
    .from('sources')
    .insert({ company_id: company.id, kind: 'ad_library_query', external_id: terms.toLowerCase(), name: `Ads: "${terms}"`, status: 'active' })
  if (error) redirect(`/c/${slug}/sources?error=source_save`)
  revalidatePath(`/c/${slug}/sources`)
  redirect(`/c/${slug}/sources?ok=added`)
}

export async function toggleSource(formData: FormData) {
  const slug = str(formData, 'slug')
  const { supabase, company } = await companyFor(slug)
  const { data: source } = await supabase.from('sources').select('*').eq('id', str(formData, 'source_id')).eq('company_id', company.id).maybeSingle<Source>()
  if (source) {
    const next = source.status === 'paused' ? (source.kind === 'public_page' && !publicContentApproved() ? 'pending_review' : 'active') : 'paused'
    await supabase.from('sources').update({ status: next, last_error: null }).eq('id', source.id)
  }
  revalidatePath(`/c/${slug}/sources`)
  redirect(`/c/${slug}/sources`)
}

export async function removeSource(formData: FormData) {
  const slug = str(formData, 'slug')
  const { supabase, company } = await companyFor(slug)
  await supabase.from('sources').delete().eq('id', str(formData, 'source_id')).eq('company_id', company.id)
  revalidatePath(`/c/${slug}/sources`)
  redirect(`/c/${slug}/sources`)
}

export async function disconnectFacebook(formData: FormData) {
  const slug = str(formData, 'slug')
  const { supabase, company } = await companyFor(slug)
  await supabase.from('connections').delete().eq('id', str(formData, 'connection_id')).eq('company_id', company.id)
  revalidatePath(`/c/${slug}/sources`)
  redirect(`/c/${slug}/sources`)
}
