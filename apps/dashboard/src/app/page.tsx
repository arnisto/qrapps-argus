import { redirect } from 'next/navigation';
import { getMeServerSide } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

/**
 * Root — dispatches based on session:
 *   · authed   → /environments (start of the authed shell)
 *   · unauthed → /signin
 *
 * The v0.2 Today dashboard now lives at /legacy/today for the few people
 * still poking at the observability product. It'll either move into the
 * authed shell or be retired in a later milestone.
 */
export default async function Home() {
  const me = await getMeServerSide();
  redirect(me ? '/environments' : '/signin');
}
