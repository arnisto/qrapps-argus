/**
 * Server-side auth helpers. Forwards the inbound `cookie` header to Fastify
 * so server components / middleware can read the current user.
 *
 * Used by:
 *   · middleware.ts (auth gate)
 *   · authed-layout server components (rendering "logged in as …")
 *   · server-side data fetches that need a user context
 */
import 'server-only';
import { cookies, headers } from 'next/headers';
import type { MeResponse } from './auth-client';

const API_BASE = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

export async function getMeServerSide(): Promise<MeResponse | null> {
  const cookieHeader = cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  if (!cookieHeader) return null;
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: {
      cookie: cookieHeader,
      // Forward UA so the session row gets a useful user_agent on refresh.
      'user-agent': headers().get('user-agent') ?? 'argus-dashboard',
    },
    cache: 'no-store',
  });
  if (res.status !== 200) return null;
  return (await res.json()) as MeResponse;
}
