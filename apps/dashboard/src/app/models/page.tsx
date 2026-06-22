import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { EnvPicker, NoEnvsCard } from '@/components/app/EnvPicker';
import { getActiveEnv } from '@/lib/active-env';
import { listProviders } from '@/lib/providers-server';
import { ConnectGeminiForm } from './ConnectGeminiForm';
import { ProviderRow } from './ProviderRow';

export const dynamic = 'force-dynamic';

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: { env?: string };
}) {
  const active = await getActiveEnv(searchParams.env);

  return (
    <AppLayout activeEnvSlug={active?.current.slug} redirectTarget="/models">
      <PageShell
        title="Models"
        subtitle="Connect an LLM to this environment. The same key powers every /v1/chat call routed through Argus for this env."
        actions={active ? <EnvPicker envs={active.all} current={active.current} /> : null}
      >
        {!active ? (
          <NoEnvsCard />
        ) : (
          <ModelsBody slug={active.current.slug} />
        )}
      </PageShell>
    </AppLayout>
  );
}

async function ModelsBody({ slug }: { slug: string }) {
  const providers = await listProviders(slug);
  const gemini = providers.find((p) => p.name === 'gemini');

  return (
    <>
      <section className="rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1.5">
          {gemini ? 'Gemini · connected' : 'Connect Gemini'}
        </h2>
        <p className="text-sm text-text-2 mb-4">
          {gemini ? (
            <>
              Active provider for <code className="font-mono text-text">{slug}</code>.
              Rotate the key by submitting again, or test connectivity below.
            </>
          ) : (
            <>
              Paste your <code className="font-mono">AIzaSy…</code> key. We
              store it AES-GCM-encrypted; the plaintext never leaves the API
              after this submission.
            </>
          )}
        </p>
        <ConnectGeminiForm envSlug={slug} existing={gemini ?? null} />
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-3">
          Connected providers ({providers.length})
        </h2>
        {providers.length === 0 ? (
          <div className="text-sm text-text-3">
            None yet — connect Gemini above to enable /v1/chat for this env.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {providers.map((p) => (
              <ProviderRow key={p.id} envSlug={slug} provider={p} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
