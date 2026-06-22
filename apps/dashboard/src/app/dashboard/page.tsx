import Link from 'next/link';
import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { getMeServerSide } from '@/lib/auth-server';
import { listEnvsServerSide } from '@/lib/envs-server';

export const dynamic = 'force-dynamic';

interface KpiSpec {
  value: string | number;
  label: string;
  sub: string;
  color: string;
  href: string;
}

export default async function DashboardPage() {
  const me = (await getMeServerSide())!;
  const envs = await listEnvsServerSide();

  const totalProviders = envs.reduce((sum, e) => sum + e.providers, 0);
  const totalSources = envs.reduce((sum, e) => sum + e.sources, 0);
  const totalChunks = envs.reduce((sum, e) => sum + e.chunks, 0);
  const totalRequests = envs.reduce((sum, e) => sum + e.requests, 0);
  const totalCost = envs.reduce((sum, e) => sum + Number(e.cost_usd || 0), 0);
  const totalKeys = envs.reduce((sum, e) => sum + e.api_keys, 0);

  const kpis: KpiSpec[] = [
    { value: envs.length, label: 'Environments', sub: 'live across your orgs', color: 'var(--accent)', href: '/environments' },
    { value: totalProviders, label: 'Models connected', sub: 'across all envs', color: 'var(--green)', href: '/models' },
    { value: `${totalSources} src`, label: 'Knowledge', sub: `${totalChunks.toLocaleString()} chunks indexed`, color: '#6b5bd6', href: '/knowledge' },
    { value: totalRequests, label: 'Requests', sub: 'total billed via /v1/chat', color: 'var(--accent)', href: '/audit' },
    { value: `$${totalCost.toFixed(4)}`, label: 'Spend', sub: 'cumulative cost', color: '#c2742e', href: '/audit' },
    { value: totalKeys, label: 'API keys', sub: 'minted, active', color: 'var(--red)', href: '/developer-api' },
  ];

  return (
    <AppLayout redirectTarget="/dashboard">
      <PageShell
        title={`Good to see you, ${me.user.name ?? me.user.email.split('@')[0]}`}
        subtitle="Your knowledge layer at a glance. Click any tile to drill in."
        maxWidth="1100px"
      >
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
          {kpis.map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="rounded-2xl border border-border bg-surface shadow-card p-5 hover:bg-surface-2 transition group"
            >
              <div
                className="font-mono text-3xl font-bold tracking-tight"
                style={{ color: k.color }}
              >
                {k.value}
              </div>
              <div className="text-sm font-semibold text-text mt-3">{k.label}</div>
              <div className="text-xs text-text-3 mt-0.5">{k.sub}</div>
            </Link>
          ))}
        </div>

        <section className="mt-6 rounded-2xl border border-border bg-surface shadow-card p-6">
          <div className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-3">
            What's wired today
          </div>
          <ul className="text-sm text-text-2 space-y-2 leading-relaxed">
            <li>✓ Auth + sessions + multi-org membership (M1–M3)</li>
            <li>✓ Environments CRUD, list + form view, org-scoped (M4)</li>
            <li>· Providers / API keys / Teach / Playground — next milestone (M5)</li>
            <li>· Members invite + roles, audit log, security guards — milestone after (M6)</li>
          </ul>
        </section>
      </PageShell>
    </AppLayout>
  );
}
