import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PREFIXES = ['/login', '/signup', '/api/meta/callback', '/api/jobs/run', '/auth/']

export function isPublicPath(pathname: string): boolean {
  return pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
}

/** Refresh the Supabase session cookie and redirect signed-out visitors away from private pages. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // No logic between createServerClient and getUser: it can sign users out at random.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`
    return NextResponse.redirect(url)
  }
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/companies'
    url.search = ''
    return NextResponse.redirect(url)
  }
  return response
}
