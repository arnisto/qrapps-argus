import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { getEnvServerSide } from '@/lib/envs-server';
import { RenameForm } from './RenameForm';
import { DangerZone } from './DangerZone';
import { FlashFromQuery } from './FlashFromQuery';

export const dynamic = 'force-dynamic';

export default async function EnvDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const detail = await getEnvServerSide(params.slug);
  if (!detail) notFound();
  const { env } = detail;
  const apiBase = `http://localhost:4000/v1`;

  return (
    <AppLayout
      activeEnvSlug={env.slug}
      redirectTarget={`/environments/${env.slug}`}
    >
      <PageShell
        title={env.name}
        subtitle={
          <>
            In <strong>{env.org_name}</strong> · base URL{' '}
            <code className="font-mono text-text-2">{apiBase}</code> · created{' '}
            {env.created_at.slice(0, 16).replace('T', ' ')}
          </>
        }
        actions={
          <Link
            href="/environments"
            className="text-text-2 text-sm hover:text-text underline-offset-4 hover:underline"
          >
            ← all environments
          </Link>
        }
      >
        <FlashFromQuery />

        <Card title="Settings">
          <RenameForm
            slug={env.slug}
            defaultName={env.name}
            defaultModel={env.primary_model}
          />
          <p className="text-xs text-text-3 mt-3">
            Slug is immutable — it's baked into the URL and into any keys minted
            under this environment.
          </p>
        </Card>

        <Card title={`Connected models (${env.providers} real)`}>
          {env.providers === 0 ? (
            <Empty>
              No providers connected yet — M5 wires the per-env Models page.
            </Empty>
          ) : (
            <Empty>
              {env.providers} provider(s) connected. (List ships in M5.)
            </Empty>
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
      </PageShell>
    </AppLayout>
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
        'mt-4 rounded-2xl shadow-card p-5',
        tone === 'danger'
          ? 'bg-surface border border-red/40'
          : 'bg-surface border border-border',
      ].join(' ')}
    >
      <h2
        className={[
          'text-2xs uppercase tracking-wider mb-3',
          tone === 'danger' ? 'text-red font-semibold' : 'text-text-3 font-semibold',
        ].join(' ')}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-text-3 text-sm">{children}</div>;
}
