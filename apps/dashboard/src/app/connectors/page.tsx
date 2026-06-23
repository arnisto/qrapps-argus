import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { EnvPicker, NoEnvsCard } from '@/components/app/EnvPicker';
import { getActiveEnv } from '@/lib/active-env';
import { getCatalogServerSide, listConnectorsServerSide } from '@/lib/connectors-server';
import { Marketplace } from '@/components/marketplace/Marketplace';

export const dynamic = 'force-dynamic';

/**
 * Knowledge connectors — databases, doc-syncs, agent tools.
 * Channels (Slack/email/SMS) live at /channels — same primitive, different filter.
 */
export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: { env?: string };
}) {
  const active = await getActiveEnv(searchParams.env);

  return (
    <AppLayout activeEnvSlug={active?.current.slug} redirectTarget="/connectors">
      <PageShell
        title="Connectors"
        subtitle="Argus's eyes — plug in your databases, your docs, and agent tools. Each one pulls knowledge into the same indexed store, citable from /v1/chat."
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

  // /connectors hides channel-kind entries — those live on /channels.
  const filteredCatalog = catalog.filter((c) => c.kind !== 'channel');
  const filteredConnected = connected.filter((c) => c.kind !== 'channel');

  return (
    <Marketplace
      envSlug={slug}
      catalog={filteredCatalog}
      connected={filteredConnected}
      searchPlaceholder="Search connectors — postgres, notion, drive…"
      connectedHeadline="Connected"
      kindFilters={[
        { value: 'all', label: 'All', matches: () => true },
        { value: 'db', label: 'Databases', matches: (e) => e.kind === 'db' },
        { value: 'doc', label: 'Doc sync', matches: (e) => e.kind === 'doc' },
        { value: 'tool', label: 'Agent tools', matches: (e) => e.kind === 'tool' },
      ]}
    />
  );
}
