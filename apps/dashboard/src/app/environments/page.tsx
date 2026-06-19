import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMeServerSide } from '@/lib/auth-server';
import { listEnvsServerSide } from '@/lib/envs-server';
import { AppHeader } from '@/components/app/AppHeader';

export const dynamic = 'force-dynamic';

/**
 * /environments — Odoo-style list view of every env the user can reach
 * (folded by org-membership server-side). One row = one env. Click the
 * name to drill into the form view.
 */
export default async function EnvironmentsPage() {
  const me = await getMeServerSide();
  if (!me) redirect('/signin?next=/environments');

  const envs = await listEnvsServerSide();

  return (
    <div className="min-h-screen bg-bg-0 text-fg-0">
      <AppHeader userLabel={me.user.name ?? me.user.email} />
      <main className="mx-auto max-w-[1280px] px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Environments</h1>
            <p className="text-fg-2 mt-1 text-sm max-w-prose">
              One per business / workspace / tenant. Each environment has its own
              connected models, knowledge core, and API keys — fully isolated.
            </p>
          </div>
          <Link
            href="/environments/new"
            className="rounded-md bg-blue text-bg-0 font-semibold px-4 py-2 text-sm hover:opacity-90 transition"
          >
            + New environment
          </Link>
        </div>

        {envs.length === 0 ? <EmptyState /> : <EnvsTable envs={envs} />}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-10 rounded-xl border border-line bg-bg-1 p-10 text-center">
      <div className="text-fg-2 text-sm">No environments yet.</div>
      <Link
        href="/environments/new"
        className="inline-block mt-4 rounded-md bg-blue text-bg-0 font-semibold px-4 py-2 text-sm hover:opacity-90"
      >
        Create your first environment
      </Link>
    </div>
  );
}

function EnvsTable({ envs }: { envs: Awaited<ReturnType<typeof listEnvsServerSide>> }) {
  return (
    <div className="mt-6 rounded-xl border border-line bg-bg-1 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-bg-2 text-fg-2 text-xs uppercase tracking-wider">
          <tr>
            <th className="text-left px-4 py-3">Name</th>
            <th className="text-left px-4 py-3 hidden sm:table-cell">Organization</th>
            <th className="text-left px-4 py-3 hidden md:table-cell">Model</th>
            <th className="text-right px-4 py-3 hidden md:table-cell">Models</th>
            <th className="text-right px-4 py-3 hidden md:table-cell">Knowledge</th>
            <th className="text-right px-4 py-3 hidden lg:table-cell">Keys</th>
            <th className="text-right px-4 py-3 hidden lg:table-cell">Reqs</th>
            <th className="text-right px-4 py-3 hidden lg:table-cell">Cost</th>
            <th className="text-right px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {envs.map((e) => (
            <tr
              key={e.id}
              className="border-t border-line hover:bg-bg-2/60 transition"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/environments/${e.slug}`}
                  className="text-blue font-medium hover:underline underline-offset-4"
                >
                  {e.name}
                </Link>
                <div className="text-xs text-fg-3 mt-0.5">
                  slug <code className="text-fg-2">{e.slug}</code>
                </div>
              </td>
              <td className="px-4 py-3 hidden sm:table-cell text-fg-1">
                {e.org_name}
              </td>
              <td className="px-4 py-3 hidden md:table-cell">
                <code className="text-xs text-fg-2">{e.primary_model}</code>
              </td>
              <td className="px-4 py-3 hidden md:table-cell text-right">{e.providers}</td>
              <td className="px-4 py-3 hidden md:table-cell text-right">
                <span className="text-fg-1">{e.sources}</span>
                <span className="text-fg-3"> src · {e.chunks} chunks</span>
              </td>
              <td className="px-4 py-3 hidden lg:table-cell text-right">{e.api_keys}</td>
              <td className="px-4 py-3 hidden lg:table-cell text-right">{e.requests}</td>
              <td className="px-4 py-3 hidden lg:table-cell text-right">
                ${Number(e.cost_usd).toFixed(4)}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/environments/${e.slug}`}
                  className="text-xs text-fg-2 hover:text-fg-0 underline-offset-4 hover:underline"
                >
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
