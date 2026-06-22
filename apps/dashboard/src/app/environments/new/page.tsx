import Link from 'next/link';
import { AppLayout } from '@/components/shell/AppLayout';
import { PageShell } from '@/components/shell/PageShell';
import { getMeServerSide } from '@/lib/auth-server';
import { NewEnvForm } from './NewEnvForm';

export const dynamic = 'force-dynamic';

export default async function NewEnvPage() {
  // AppLayout already does the auth check, but we need orgs[0].name for the
  // copy below; fetch /auth/me locally to surface it.
  const me = (await getMeServerSide())!;

  return (
    <AppLayout redirectTarget="/environments/new">
      <PageShell
        title="New environment"
        subtitle={
          <>
            Creates a fresh tenant in{' '}
            <strong>{me.orgs[0]?.name ?? 'your workspace'}</strong>. You can
            connect models and ingest knowledge once it exists.
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
        maxWidth="640px"
      >
        <div className="rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
          <NewEnvForm />
        </div>
      </PageShell>
    </AppLayout>
  );
}
