import { redirect } from 'next/navigation';
import { getMeServerSide } from '@/lib/auth-server';
import { SignoutButton } from './SignoutButton';

export const dynamic = 'force-dynamic';

/**
 * M3 placeholder. Proves end-to-end auth in the browser:
 *   1. server component fetches /auth/me via getMeServerSide()
 *   2. unauthed users get bounced to /signin
 *   3. authed users see their user + orgs straight from the Fastify session
 *
 * The full Odoo-style list+form view of environments ports in M4–M5 once
 * the envs CRUD endpoints land in Fastify (proper org scoping, RBAC).
 */
export default async function EnvironmentsPage() {
  const me = await getMeServerSide();
  if (!me) redirect('/signin?next=/environments');

  return (
    <div className="min-h-screen bg-bg-0 text-fg-0">
      <header className="border-b border-line px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-[18px]">🛰️</span>
          <span className="font-semibold tracking-tight">Argus</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-fg-2">
            {me.user.name ?? me.user.email}
          </span>
          <SignoutButton />
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Environments</h1>
        <p className="text-fg-2 mt-1.5 text-sm">
          One per business / workspace / tenant. Each environment has its own connected
          models, knowledge core, and API keys.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <section className="bg-bg-1 border border-line rounded-xl p-5">
            <h2 className="text-sm uppercase tracking-wider text-fg-2">You</h2>
            <dl className="mt-3 text-sm space-y-1.5">
              <Row k="Name" v={me.user.name ?? '—'} />
              <Row k="Email" v={me.user.email} />
              <Row k="User ID" v={<code className="text-xs">{me.user.id}</code>} />
              <Row k="Super-admin" v={me.user.is_superadmin ? 'yes' : 'no'} />
            </dl>
          </section>

          <section className="bg-bg-1 border border-line rounded-xl p-5">
            <h2 className="text-sm uppercase tracking-wider text-fg-2">
              Your organizations ({me.orgs.length})
            </h2>
            <ul className="mt-3 text-sm space-y-2">
              {me.orgs.map((o) => (
                <li key={o.id} className="flex items-baseline justify-between gap-3">
                  <div>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-fg-3">
                      slug <code className="text-fg-2">{o.slug}</code>
                    </div>
                  </div>
                  <span className="text-2xs uppercase tracking-wider px-2 py-0.5 rounded bg-blue/10 text-blue">
                    {o.role}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-8 bg-bg-1 border border-line rounded-xl p-5">
          <h2 className="text-sm uppercase tracking-wider text-fg-2">Next up — M4</h2>
          <p className="text-sm mt-2 text-fg-1">
            Environments CRUD (list + form view) wired against the new <code>envs</code>{' '}
            table, scoped by org membership. Then Teach / Models / API / Playground get
            ported from the Python MVP into Next.js + Tailwind.
          </p>
        </section>
      </main>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 text-fg-3">{k}</dt>
      <dd className="text-fg-1">{v}</dd>
    </div>
  );
}
