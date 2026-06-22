import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { EnvPicker, NoEnvsCard } from '@/components/app/EnvPicker';
import { getActiveEnv } from '@/lib/active-env';
import { listSources } from '@/lib/providers-server';
import { UploadDropzone } from './UploadDropzone';
import { SourceList } from './SourceList';
import { QaForm } from './QaForm';

export const dynamic = 'force-dynamic';

export default async function TeachPage({
  searchParams,
}: {
  searchParams: { env?: string };
}) {
  const active = await getActiveEnv(searchParams.env);

  return (
    <AppLayout activeEnvSlug={active?.current.slug} redirectTarget="/teach">
      <PageShell
        title="Teach Argus"
        subtitle="Drop files into this environment's knowledge core. Each file is chunked, embedded, and indexed inline — your next /v1/chat call grounds on it."
        actions={active ? <EnvPicker envs={active.all} current={active.current} /> : null}
      >
        {!active ? (
          <NoEnvsCard />
        ) : (
          <TeachBody slug={active.current.slug} />
        )}
      </PageShell>
    </AppLayout>
  );
}

async function TeachBody({ slug }: { slug: string }) {
  const sources = await listSources(slug);
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
          <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-2 border-b border-border pb-3 mb-4">
            Upload a file
          </h2>
          <UploadDropzone envSlug={slug} />
          <p className="text-xs text-text-3 mt-3">
            Supported: <code className="font-mono">.md</code>,{' '}
            <code className="font-mono">.txt</code>,{' '}
            <code className="font-mono">.html</code>. PDF support lands next. 5 MB max.
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
          <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-2 border-b border-border pb-3 mb-4">
            Teach a Q&amp;A pair
          </h2>
          <QaForm envSlug={slug} />
          <p className="text-xs text-text-3 mt-3">
            Q&amp;A pairs are higher-authority than file chunks — they outrank
            documents in retrieval, so a freshly-taught answer wins immediately.
          </p>
        </section>
      </div>

      <section className="mt-5 rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-2 border-b border-border pb-3 mb-4">
          Knowledge in this env ({sources.length} sources)
        </h2>
        <SourceList envSlug={slug} sources={sources} />
      </section>
    </>
  );
}
