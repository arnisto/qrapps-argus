import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import type { Company } from './db-types'

/** Load a company the signed-in user belongs to (RLS hides the rest), or 404. */
export async function loadCompany(slug: string) {
  const supabase = await createClient()
  const { data: company } = await supabase.from('companies').select('*').eq('slug', slug).maybeSingle<Company>()
  if (!company) notFound()
  return { supabase, company }
}
