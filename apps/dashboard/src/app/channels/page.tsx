import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { EnvPicker, NoEnvsCard } from '@/components/app/EnvPicker';
import { getActiveEnv } from '@/lib/active-env';
import { getCatalogServerSide, listConnectorsServerSide } from '@/lib/connectors-server';
import { ChannelsBody } from './ChannelsBody';

export const dynamic = 'force-dynamic';

/**
 * Channels — the OTHER half of connectors. Sends + receives messages
 * (Slack, email, SMS). Shares storage with /connectors (env_connectors
 * table, kind='channel'); shares the marketplace UI primitive. Routes
 * here are the surfaces operators use to chat with the bot or receive
 * inbound questions from customers.
 */
export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: { env?: string };
}) {
  const active = await getActiveEnv(searchParams.env);
  return (
    <AppLayout activeEnvSlug={active?.current.slug} redirectTarget="/channels">
      <PageShell
        title="Channels"
        subtitle="Argus's voice — connect Slack, email, or SMS. Argus DMs the right teammate when a chat hits a knowledge gap, ingests their reply forever, and sends drafted replies back."
        actions={active ? <EnvPicker envs={active.all} current={active.current} /> : null}
        maxWidth="1180px"
      >
        {!active ? <NoEnvsCard /> : <Body slug={active.current.slug} />}
      </PageShell>
    </AppLayout>
  );
}

async function Body({ slug }: { slug: string }) {
  const [catalog, connected] = await Promise.all([
    getCatalogServerSide(),
    listConnectorsServerSide(slug),
  ]);

  // /channels only shows channel-kind entries.
  const channelCatalog = catalog.filter((c) => c.kind === 'channel');
  const channelConnected = connected.filter((c) => c.kind === 'channel');

  return <ChannelsBody envSlug={slug} catalog={channelCatalog} connected={channelConnected} />;
}
