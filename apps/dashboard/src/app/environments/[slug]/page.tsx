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

        <Card
          title={`Connected models (${env.providers})`}
          href={`/models?env=${env.slug}`}
          ctaLabel={env.providers === 0 ? 'Connect a model →' : 'Manage models →'}
        >
          {env.providers === 0 ? (
            <Empty>
              No providers connected yet. Argus needs Gemini for embeddings; Groq
              is an optional chat-speed boost.
            </Empty>
          ) : (
            <Empty>
              {env.providers} provider{env.providers === 1 ? '' : 's'} connected.
              Default model: <code className="font-mono text-text">{env.primary_model}</code>.
            </Empty>
          )}
        </Card>

        <Card
          title={`API keys (${env.api_keys})`}
          href={`/developer-api?env=${env.slug}`}
          ctaLabel={env.api_keys === 0 ? 'Mint a key →' : 'Manage keys →'}
        >
          <Empty>
            {env.api_keys === 0
              ? 'No keys minted yet. Mint one to call /v1/chat from your code.'
              : `${env.api_keys} active key${env.api_keys === 1 ? '' : 's'} on file.`}
          </Empty>
        </Card>

        <Card
          title={`Knowledge (${env.sources} sources · ${env.chunks} chunks)`}
          href={`/teach?env=${env.slug}`}
          ctaLabel={env.sources === 0 ? 'Teach Argus →' : 'Add more →'}
        >
          <Empty>
            {env.sources === 0
              ? 'Drop a file or paste a Q&A pair to give this env real grounded answers.'
              : `${env.chunks} chunk${env.chunks === 1 ? '' : 's'} indexed across ${env.sources} source${env.sources === 1 ? '' : 's'}.`}
          </Empty>
        </Card>

        <Card
          title="Recent activity"
          href={`/ask?env=${env.slug}`}
          ctaLabel={env.requests === 0 ? 'Try the Playground →' : 'Ask another →'}
        >
          <Empty>
            {env.requests === 0
              ? 'No requests yet.'
              : `${env.requests} request${env.requests === 1 ? '' : 's'} so far · total spend $${Number(env.cost_usd).toFixed(4)}.`}
            {env.last_request_at
              ? ` Last call ${env.last_request_at.slice(0, 16).replace('T', ' ')}.`
              : ''}
          </Empty>
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
  href,
  ctaLabel,
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'danger';
  href?: string;
  ctaLabel?: string;
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
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3 mb-3">
        <h2
          className={[
            'text-2xs uppercase tracking-wider font-semibold',
            tone === 'danger' ? 'text-red' : 'text-text-2',
          ].join(' ')}
        >
          {title}
        </h2>
        {href && ctaLabel ? (
          <Link
            href={href}
            className="text-2xs font-semibold text-accent hover:underline underline-offset-4"
          >
            {ctaLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-text-2 text-sm leading-relaxed">{children}</div>;
}
