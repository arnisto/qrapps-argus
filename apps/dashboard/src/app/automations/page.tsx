import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { EnvPicker, NoEnvsCard } from '@/components/app/EnvPicker';
import { getActiveEnv } from '@/lib/active-env';
import { listAutomationsServerSide } from '@/lib/automations-server';
import { AutomationsList } from './AutomationsList';

export const dynamic = 'force-dynamic';

/**
 * Automations — scheduled jobs that read from a connector, render with the LLM,
 * and send through a channel. The whole pipeline driven by one English prompt
 * compiled at save time. See docs/ARCHITECTURE_AUTOMATIONS.md.
 */
export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: { env?: string };
}) {
  const active = await getActiveEnv(searchParams.env);
  return (
    <AppLayout activeEnvSlug={active?.current.slug} redirectTarget="/automations">
      <PageShell
        title="Automations"
        subtitle="Tell Argus what to do and when. It pulls from your connectors, summarises with grounded citations, and posts through your channels — on schedule, forever."
        actions={active ? <EnvPicker envs={active.all} current={active.current} /> : null}
        maxWidth="1180px"
      >
        {!active ? <NoEnvsCard /> : <Body slug={active.current.slug} />}
      </PageShell>
    </AppLayout>
  );
}

async function Body({ slug }: { slug: string }) {
  const automations = await listAutomationsServerSide(slug);
  return <AutomationsList envSlug={slug} initialRows={automations} />;
}
