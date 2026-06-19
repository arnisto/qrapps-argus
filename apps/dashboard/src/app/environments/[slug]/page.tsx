import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getMeServerSide } from '@/lib/auth-server';
import { getEnvServerSide } from '@/lib/envs-server';
import { AppHeader } from '@/components/app/AppHeader';
import { RenameForm } from './RenameForm';
import { DangerZone } from './DangerZone';
import { FlashFromQuery } from './FlashFromQuery';

export const dynamic = 'force-dynamic';

/**
 * /environments/[slug] — Odoo-style form view of one env:
 *   Settings (rename + model) · Connected models · API keys · Knowledge ·
 *   Recent requests · Danger zone (delete)
 *
 * Most sub-sections currently say "0 — connect some in M5" because the
 * providers / keys / sources / requests endpoints aren't wired yet. The
 * shape is the source of truth; M5 fills in the data.
 */
export default async function EnvDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const me = await getMeServerSide();
  if (!me) redirect(`/signin?next=/environments/${params.slug}`);

  const detail = await getEnvServerSide(params.slug);
  if (!detail) notFound();

  const { env } = detail;
  const apiBase = `http://localhost:4000/v1`; // legacy single-tenant slug; M5 introduces per-env routing

  return (
    <div className="min-h-screen bg-bg-0 text-fg-0">
      <AppHeader userLabel={me.user.name ?? me.user.email} />
      <main className="mx-auto max-w-[1080px] px-4 sm:px-6 py-6 sm:py-8">
        <Link
          href="/environments"
          className="text-fg-2 text-sm hover:text-fg-0 underline-offset-4 hover:underline"
        >
          ← all environments
        </Link>

        <div className="mt-2 flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{env.name}</h1>
          <span className="text-fg-3 text-sm">
            · <code>{env.slug}</code>
          </span>
        </div>
        <p className="text-fg-2 text-sm mt-1">
          In <strong>{env.org_name}</strong> · base URL{' '}
          <code className="text-fg-1">{apiBase}</code> · created{' '}
          {env.created_at.slice(0, 16).replace('T', ' ')}
        </p>

        <FlashFromQuery />

        <Card title="Settings">
          <RenameForm
            slug={env.slug}
            defaultName={env.name}
            defaultModel={env.primary_model}
          />
          <p className="text-xs text-fg-3 mt-3">
            Slug is immutable — it's baked into the URL and into any keys minted under
            this environment.
          </p>
        </Card>

        <Card title={`Connected models (${env.providers} real)`}>
          {env.providers === 0 ? (
            <Empty>
              No providers connected yet — M5 wires the per-env Models page.
            </Empty>
          ) : (
            <Empty>{env.providers} provider(s) connected. (List view ships in M5.)</Empty>
          )}
        </Card>

        <Card title={`API keys (${env.api_keys})`}>
          <Empty>
            {env.api_keys} key(s) issued. Minting + revoking lands in M5.
          </Empty>
        </Card>

        <Card title={`Knowledge (${env.sources} sources · ${env.chunks} chunks)`}>
          <Empty>
            Upload files or add Q&A to give this env real grounded answers (M5).
          </Empty>
        </Card>

        <Card title="Recent requests">
          {env.requests === 0 ? (
            <Empty>No requests yet — try the Playground (M5).</Empty>
          ) : (
            <Empty>
              {env.requests} request(s) so far · total cost ${Number(env.cost_usd).toFixed(4)}
            </Empty>
          )}
        </Card>

        <Card title="Danger zone" tone="danger">
          <DangerZone slug={env.slug} />
        </Card>
      </main>
    </div>
  );
}

function Card({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'danger';
}) {
  return (
    <section
      className={[
        'mt-5 rounded-xl border p-5',
        tone === 'danger' ? 'bg-bg-1 border-rose/40' : 'bg-bg-1 border-line',
      ].join(' ')}
    >
      <h2
        className={[
          'text-sm uppercase tracking-wider mb-3',
          tone === 'danger' ? 'text-rose' : 'text-fg-2',
        ].join(' ')}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-fg-3 text-sm">{children}</div>;
}
