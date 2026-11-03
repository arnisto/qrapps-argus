import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { safeNext } from '@/lib/safe-next'

/** Email confirmation link lands here: exchange the code for a session, then continue. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const next = safeNext(req.nextUrl.searchParams.get('next'))
  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, req.url))
  }
  return NextResponse.redirect(new URL('/login?error=link', req.url))
}
