import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { EnvPicker, NoEnvsCard } from '@/components/app/EnvPicker';
import { getActiveEnv } from '@/lib/active-env';
import { listApiKeys } from '@/lib/providers-server';
import { KeysSection } from './KeysSection';
import { CurlPanel } from './CurlPanel';

export const dynamic = 'force-dynamic';

// Public-facing API base — what a buyer pastes into their client. Lives in
// next.config rewrites in prod; for dev we hit Fastify directly.
const PUBLIC_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default async function DeveloperApiPage({
  searchParams,
}: {
  searchParams: { env?: string };
}) {
  const active = await getActiveEnv(searchParams.env);

  return (
    <AppLayout activeEnvSlug={active?.current.slug} redirectTarget="/developer-api">
      <PageShell
        title="Developer API"
        subtitle="OpenAI-compatible chat completions with grounded citations injected. Drop into any client by swapping baseURL and the API key."
        actions={active ? <EnvPicker envs={active.all} current={active.current} /> : null}
        maxWidth="1080px"
      >
        {!active ? (
          <NoEnvsCard />
        ) : (
          <DeveloperApiBody slug={active.current.slug} />
        )}
      </PageShell>
    </AppLayout>
  );
}

async function DeveloperApiBody({ slug }: { slug: string }) {
  const keys = await listApiKeys(slug);
  return (
    <>
      <section className="rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1.5">
          Base URL
        </h2>
        <p className="text-sm text-text-2 mb-3">
          Same shape as OpenAI's API. Drop in any OpenAI client and swap the baseURL.
        </p>
        <code className="block font-mono text-sm bg-inset border border-border rounded-md px-3 py-2 break-all">
          {PUBLIC_API_BASE}/v1
        </code>
      </section>

      <KeysSection envSlug={slug} keys={keys} />

      <CurlPanel envSlug={slug} apiBase={`${PUBLIC_API_BASE}/v1`} />

      <section className="mt-5 rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1.5">
          What the response carries
        </h2>
        <p className="text-sm text-text-2 mb-3">
          Standard OpenAI shape plus an <code className="font-mono">argus_citations</code>{' '}
          array. When retrieval finds nothing relevant, a top-level{' '}
          <code className="font-mono">argus_warning: "no_grounded_context"</code> flag
          is set — your app can show a "I don't have that info yet" UI without
          parsing the model's prose.
        </p>
      </section>
    </>
  );
}
