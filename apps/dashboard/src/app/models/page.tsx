import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { EnvPicker, NoEnvsCard } from '@/components/app/EnvPicker';
import { getActiveEnv } from '@/lib/active-env';
import { listProviders, type ProviderRow } from '@/lib/providers-server';
import { ConnectProviderForm, type ProviderDef } from './ConnectProviderForm';
import { ProviderRow as ProviderRowCmp } from './ProviderRow';

export const dynamic = 'force-dynamic';

/**
 * The set of providers we know how to wire today. Order matters — Gemini
 * is required (it powers embeddings); Groq is a fast / cheap chat option.
 * Add new entries as we port more clients.
 */
const PROVIDERS: ProviderDef[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    placeholder: 'AIzaSy…',
    default_model: 'gemini-2.5-flash',
    keyHelp:
      'Required — powers embeddings AND chat. Get a key at aistudio.google.com (free tier is enough to demo).',
  },
  {
    id: 'groq',
    label: 'Groq',
    placeholder: 'gsk_…',
    default_model: 'llama-3.3-70b-versatile',
    keyHelp:
      'Optional chat provider. ~10x faster than Gemini on Llama. Get a key at console.groq.com/keys.',
  },
];

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
        subtitle="Connect one or more LLM providers to this environment. Argus routes each /v1/chat call based on the model name: gemini-* → Gemini, llama-*/mixtral-* → Groq."
        actions={active ? <EnvPicker envs={active.all} current={active.current} /> : null}
      >
        {!active ? <NoEnvsCard /> : <ModelsBody slug={active.current.slug} />}
      </PageShell>
    </AppLayout>
  );
}

async function ModelsBody({ slug }: { slug: string }) {
  const providers = await listProviders(slug);
  const byName = new Map(providers.map((p) => [p.name, p]));
  const hasGemini = !!byName.get('gemini');

  return (
    <>
      {!hasGemini ? (
        <div className="mb-5 rounded-xl border border-amber/40 bg-amber-soft px-4 py-3 text-sm">
          <strong className="text-amber">Gemini is required.</strong>{' '}
          <span className="text-text-2">
            Embeddings run on <code className="font-mono">gemini-embedding-001</code>{' '}
            (768d) — without a Gemini key, source upload and grounded chat both 412.
            Groq is chat-only.
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {PROVIDERS.map((def) => {
          const existing = byName.get(def.id) ?? null;
          return (
            <section
              key={def.id}
              className="rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6"
            >
              <div className="flex items-center justify-between mb-1.5">
                <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-3">
                  {def.label} {existing ? '· connected' : ''}
                </h2>
                {existing ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-2xs font-semibold text-green bg-green-soft px-2 py-0.5 rounded-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-green" />
                    key on file
                  </span>
                ) : (
                  <span className="font-mono text-2xs font-semibold text-text-3 bg-inset px-2 py-0.5 rounded-sm">
                    not connected
                  </span>
                )}
              </div>
              <p className="text-sm text-text-2 mb-4">
                {existing ? (
                  <>
                    Active for <code className="font-mono text-text">{slug}</code>. Submit
                    again to rotate the key.
                  </>
                ) : (
                  <>Paste your key — we store it AES-GCM-encrypted; the plaintext never leaves the API after submission.</>
                )}
              </p>
              <ConnectProviderForm envSlug={slug} def={def} existing={existing} />
            </section>
          );
        })}
      </div>

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
            {providers.map((p: ProviderRow) => (
              <ProviderRowCmp key={p.id} envSlug={slug} provider={p} />
            ))}
          </ul>
        )}
        <p className="text-2xs text-text-3 mt-3">
          The model on the <code className="font-mono">/v1/chat/completions</code> call picks
          the provider: <code className="font-mono">gemini-*</code> →
          Gemini, <code className="font-mono">llama-*</code> /
          <code className="font-mono">mixtral-*</code> /
          <code className="font-mono">groq/*</code> → Groq.
        </p>
      </section>
    </>
  );
}
