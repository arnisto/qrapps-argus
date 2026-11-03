import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { oauthDialogUrl } from '@/lib/meta/graph'
import { META_STATE_COOKIE, newState } from '@/lib/meta/state'

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('company') ?? ''
  const supabase = await createClient()
  // RLS: only a member gets the row back.
  const { data: company } = await supabase.from('companies').select('slug').eq('slug', slug).maybeSingle()
  if (!company) return NextResponse.redirect(new URL('/companies', req.url))

  const { state, cookie } = newState(company.slug)
  let target: string
  try {
    target = oauthDialogUrl(state)
  } catch {
    return NextResponse.redirect(new URL(`/c/${company.slug}/sources?error=meta_not_configured`, req.url))
  }
  const res = NextResponse.redirect(target)
  res.cookies.set(META_STATE_COOKIE, cookie, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 600, path: '/' })
  return res
}
