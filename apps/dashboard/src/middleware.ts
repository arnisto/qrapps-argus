import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/auth-constants';

/**
 * Cheap pre-filter for "is the user signed in?" — checks for the session
 * cookie's presence only. Server components still call /auth/me for the
 * real check (cookie could be expired / forged); middleware just avoids
 * the round-trip when there's clearly no session at all.
 *
 * Public paths: anything in the (auth) route group, plus assets and API
 * proxy paths. Everything else requires the cookie.
 */
const PUBLIC_PATTERNS: RegExp[] = [
  /^\/signin(\/|$)/,
  /^\/signup(\/|$)/,
  /^\/forgot-password(\/|$)/,
  /^\/reset-password(\/|$)/,
  /^\/legacy(\/|$)/, // legacy v0.2 pages — gated by bearer token elsewhere
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((re) => re.test(pathname));
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE);
  if (cookie) return NextResponse.next();

  const next = encodeURIComponent(pathname + search);
  const url = req.nextUrl.clone();
  url.pathname = '/signin';
  url.search = `?next=${next}`;
  return NextResponse.redirect(url);
}

/**
 * Skip middleware for:
 *   · /_next/* and /favicon.ico  — Next.js assets
 *   · /api/*                     — internal Next.js route handlers
 *   · /be/*                      — Fastify proxy; Fastify gates itself
 *
 * Everything else hits the middleware and goes through the public/authed
 * fork above.
 */
export const config = {
  matcher: ['/((?!_next/|api/|be/|favicon.ico|robots.txt|sitemap.xml).*)'],
};
