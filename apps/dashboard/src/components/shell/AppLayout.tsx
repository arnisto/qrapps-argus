import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getMeServerSide } from '@/lib/auth-server';
import { listEnvsServerSide } from '@/lib/envs-server';
import { ClientShell } from './ClientShell';
import { THEME_NOFLASH_SCRIPT } from './ThemeToggle';

/**
 * Server-side wrapper for every authed page. Runs the auth check, fetches
 * /auth/me + /envs, and hands the data into the client shell. The page
 * itself is a server component passed as `children` — Next renders it
 * normally even though it's wrapped in a client boundary.
 *
 *   <AppLayout activeEnvSlug={...} redirectTarget={...}>
 *     <YourPage />
 *   </AppLayout>
 */
export async function AppLayout({
  children,
  activeEnvSlug,
  redirectTarget,
}: {
  children: ReactNode;
  activeEnvSlug?: string;
  redirectTarget: string;
}) {
  const me = await getMeServerSide();
  if (!me) redirect(`/signin?next=${encodeURIComponent(redirectTarget)}`);

  const envs = await listEnvsServerSide();
  const activeOrg = me.orgs[0];
  if (!activeOrg) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-bg text-text p-6">
        <div className="max-w-md text-center p-8 rounded-2xl border border-border bg-surface shadow-card">
          <h1 className="text-xl font-semibold mb-2">No organization yet</h1>
          <p className="text-sm text-text-2">
            Your account isn't a member of any organization. Reach out to the
            owner of one, or contact support.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <script
        // Static no-flash bootstrap — safe; see ThemeToggle.tsx.
        // eslint-disable-next-line react/no-danger -- static no-flash bootstrap
        dangerouslySetInnerHTML={{ __html: THEME_NOFLASH_SCRIPT }}
      />
      <ClientShell
        user={me.user}
        orgs={me.orgs}
        activeOrgSlug={activeOrg.slug}
        envs={envs.map((e) => ({ slug: e.slug, name: e.name }))}
        activeEnvSlug={activeEnvSlug}
      >
        {children}
      </ClientShell>
    </>
  );
}
