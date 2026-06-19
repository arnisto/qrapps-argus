import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMeServerSide } from '@/lib/auth-server';
import { AppHeader } from '@/components/app/AppHeader';
import { NewEnvForm } from './NewEnvForm';

export const dynamic = 'force-dynamic';

export default async function NewEnvPage() {
  const me = await getMeServerSide();
  if (!me) redirect('/signin?next=/environments/new');

  return (
    <div className="min-h-screen bg-bg-0 text-fg-0">
      <AppHeader userLabel={me.user.name ?? me.user.email} />
      <main className="mx-auto max-w-[640px] px-4 sm:px-6 py-8">
        <Link href="/environments" className="text-fg-2 text-sm hover:text-fg-0">
          ← all environments
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">New environment</h1>
        <p className="text-fg-2 text-sm mt-1">
          Creates a fresh tenant in <strong>{me.orgs[0]?.name ?? 'your workspace'}</strong>.
          You can connect models and ingest knowledge once it exists.
        </p>
        <div className="mt-6 rounded-xl border border-line bg-bg-1 p-5 sm:p-6">
          <NewEnvForm />
        </div>
      </main>
    </div>
  );
}
