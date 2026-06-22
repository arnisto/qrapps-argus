import Link from 'next/link';
import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { listEnvsServerSide, type EnvRow } from '@/lib/envs-server';

export const dynamic = 'force-dynamic';

/**
 * /environments — list view of every env the user can reach (folded by
 * org-membership server-side). Click a row to drill into the form view.
 */
export default async function EnvironmentsPage() {
  const envs = await listEnvsServerSide();

  return (
    <AppLayout redirectTarget="/environments">
      <PageShell
        title="Environments"
        subtitle="One per business / workspace / tenant. Each environment is fully isolated — its own connected models, knowledge core, and API keys."
        actions={
          <Link
            href="/environments/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-white font-semibold px-3.5 py-2 text-sm hover:opacity-90 transition"
          >
            + New environment
          </Link>
        }
      >
        {envs.length === 0 ? <EmptyState /> : <EnvsTable envs={envs} />}
      </PageShell>
    </AppLayout>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-10 text-center">
      <div className="text-text-2 text-base">No environments yet.</div>
      <Link
        href="/environments/new"
        className="inline-flex items-center gap-1.5 mt-4 rounded-lg bg-accent text-white font-semibold px-3.5 py-2 text-sm hover:opacity-90 transition"
      >
        Create your first environment
      </Link>
    </div>
  );
}

function EnvsTable({ envs }: { envs: EnvRow[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card overflow-x-auto">
      <table className="w-full text-sm min-w-[480px]">
        <thead className="bg-inset text-text-3 font-mono">
          <tr>
            <th className="text-left px-4 py-3 text-2xs uppercase tracking-wider">Name</th>
            <th className="text-left px-4 py-3 text-2xs uppercase tracking-wider hidden sm:table-cell">
              Organization
            </th>
            <th className="text-left px-4 py-3 text-2xs uppercase tracking-wider hidden md:table-cell">
              Model
            </th>
            <th className="text-right px-4 py-3 text-2xs uppercase tracking-wider hidden md:table-cell">
              Models
            </th>
            <th className="text-right px-4 py-3 text-2xs uppercase tracking-wider hidden md:table-cell">
              Knowledge
            </th>
            <th className="text-right px-4 py-3 text-2xs uppercase tracking-wider hidden lg:table-cell">
              Keys
            </th>
            <th className="text-right px-4 py-3 text-2xs uppercase tracking-wider hidden lg:table-cell">
              Reqs
            </th>
            <th className="text-right px-4 py-3 text-2xs uppercase tracking-wider hidden lg:table-cell">
              Cost
            </th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {envs.map((e) => (
            <tr
              key={e.id}
              className="border-t border-border hover:bg-surface-2 transition"
            >
              <td className="px-4 py-3 align-top">
                <Link
                  href={`/environments/${e.slug}`}
                  className="text-accent font-semibold hover:underline underline-offset-4"
                >
                  {e.name}
                </Link>
                <div className="text-2xs text-text-3 mt-0.5">
                  slug <code className="font-mono text-text-2">{e.slug}</code>
                </div>
              </td>
              <td className="px-4 py-3 align-top hidden sm:table-cell text-text">
                {e.org_name}
              </td>
              <td className="px-4 py-3 align-top hidden md:table-cell">
                <code className="font-mono text-2xs text-text-2 bg-inset px-1.5 py-0.5 rounded-sm">
                  {e.primary_model}
                </code>
              </td>
              <td className="px-4 py-3 align-top hidden md:table-cell text-right text-text">
                {e.providers}
              </td>
              <td className="px-4 py-3 align-top hidden md:table-cell text-right">
                <span className="text-text">{e.sources}</span>
                <span className="text-text-3"> src · {e.chunks} chunks</span>
              </td>
              <td className="px-4 py-3 align-top hidden lg:table-cell text-right text-text">
                {e.api_keys}
              </td>
              <td className="px-4 py-3 align-top hidden lg:table-cell text-right text-text">
                {e.requests}
              </td>
              <td className="px-4 py-3 align-top hidden lg:table-cell text-right text-text font-mono text-2xs">
                ${Number(e.cost_usd).toFixed(4)}
              </td>
              <td className="px-4 py-3 align-top text-right">
                <Link
                  href={`/environments/${e.slug}`}
                  className="text-2xs text-text-2 hover:text-text underline-offset-4 hover:underline"
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
