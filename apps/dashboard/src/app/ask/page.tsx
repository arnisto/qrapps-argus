import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { EnvPicker, NoEnvsCard } from '@/components/app/EnvPicker';
import { getActiveEnv } from '@/lib/active-env';
import { Playground } from './Playground';

export const dynamic = 'force-dynamic';

/**
 * /ask — the Playground. The buyer sees one query → one grounded reply →
 * clickable citation chips. This is what their developers will see when they
 * hit /v1/chat/completions from their code; the dashboard just wraps it with
 * a UI.
 */
export default async function AskPage({
  searchParams,
}: {
  searchParams: { env?: string };
}) {
  const active = await getActiveEnv(searchParams.env);

  return (
    <AppLayout activeEnvSlug={active?.current.slug} redirectTarget="/ask">
      <PageShell
        title="Ask Argus"
        subtitle="A grounded chat against this env's knowledge core. Same engine as /v1/chat/completions — the citation chips show exactly which chunks Argus used."
        actions={active ? <EnvPicker envs={active.all} current={active.current} /> : null}
        maxWidth="900px"
      >
        {!active ? <NoEnvsCard /> : <Playground envSlug={active.current.slug} />}
      </PageShell>
    </AppLayout>
  );
}
