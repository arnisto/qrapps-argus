'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { proposeObjective } from '@/lib/ai/propose-objective'
import type { Company } from '@/lib/db-types'

export async function createCompany(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim().slice(0, 1000)
  const country = String(formData.get('country') ?? 'TN').trim().toUpperCase().slice(0, 2) || 'TN'
  const city = String(formData.get('city') ?? '').trim() || null
  if (name.length < 2 || name.length > 80) redirect('/companies?error=company_name')

  const supabase = await createClient()
  const { data: company, error } = await supabase
    .rpc('create_company', { p_name: name, p_description: description, p_country: country, p_city: city })
    .single<Company>()
  if (error || !company) redirect('/companies?error=company_create')

  // Argus proposes the default objective right away. Nothing runs until the owner confirms it.
  const { proposal, by } = await proposeObjective({ name, description, country, city, sources: [] })
  await supabase.from('objectives').insert({
    company_id: company.id,
    title: proposal.title,
    description: proposal.description,
    plan: { watch: proposal.watch, signal_kinds: proposal.signal_kinds, ad_library_terms: proposal.ad_library_terms },
    cadence: proposal.cadence,
    status: 'proposed',
    proposed_by: by,
  })
  redirect(`/c/${company.slug}`)
}
