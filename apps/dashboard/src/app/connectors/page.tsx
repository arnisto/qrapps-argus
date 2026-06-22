import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { EnvPicker, NoEnvsCard } from '@/components/app/EnvPicker';
import { getActiveEnv } from '@/lib/active-env';
import { getCatalogServerSide, listConnectorsServerSide } from '@/lib/connectors-server';
import { ConnectorsMarketplace } from './ConnectorsMarketplace';

export const dynamic = 'force-dynamic';

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
        subtitle="Argus's eyes and ears. Plug in your databases, your team chat, your docs — every connector pulls knowledge into the same indexed store, citable from /v1/chat."
        actions={active ? <EnvPicker envs={active.all} current={active.current} /> : null}
        maxWidth="1180px"
      >
        {!active ? (
          <NoEnvsCard />
        ) : (
          <ConnectorsBody slug={active.current.slug} />
        )}
      </PageShell>
    </AppLayout>
  );
}

async function ConnectorsBody({ slug }: { slug: string }) {
  // Catalog is static + public; the connected list is per-env.
  const [catalog, connected] = await Promise.all([
    getCatalogServerSide(),
    listConnectorsServerSide(slug),
  ]);
  return <ConnectorsMarketplace envSlug={slug} catalog={catalog} connected={connected} />;
}
