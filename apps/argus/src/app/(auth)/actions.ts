'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { safeNext } from '@/lib/safe-next'

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = safeNext(String(formData.get('next') ?? ''))
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect(`/login?error=credentials&next=${encodeURIComponent(next)}`)
  redirect(next)
}

export async function signUp(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (password.length < 8) redirect('/signup?error=signup')
  const origin = (await headers()).get('origin') ?? ''
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name }, emailRedirectTo: `${origin}/auth/callback?next=/companies` },
  })
  if (error) redirect('/signup?error=signup')
  // With email confirmation on, there is no session until the link is clicked.
  if (!data.session) redirect('/login?ok=check_email')
  redirect('/companies')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
