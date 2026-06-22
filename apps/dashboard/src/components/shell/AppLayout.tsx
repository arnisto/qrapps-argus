import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getMeServerSide } from '@/lib/auth-server';
import { listEnvsServerSide } from '@/lib/envs-server';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { THEME_NOFLASH_SCRIPT } from './ThemeToggle';

/**
 * Authed shell. Wrap every authed page with this — it does the auth check,
 * fetches /auth/me + /envs, and renders TopBar + Sidebar + the page in the
 * remaining flex area. The page itself is responsible for scrolling its
 * own content; the outer frame is fixed to the viewport.
 *
 *   <AppLayout activeEnvSlug={params.slug}>
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
    // Edge case: user has no org membership (shouldn't happen post-signup,
    // but be explicit rather than silently rendering an empty shell).
    return (
      <div className="h-screen flex items-center justify-center bg-bg text-text">
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
        // No-flash dark-mode bootstrap. `THEME_NOFLASH_SCRIPT` is a
        // build-time STATIC string from ./ThemeToggle — never user input,
        // never interpolated — so dangerouslySetInnerHTML is safe here.
        // It MUST be inline so it runs before React hydrates; otherwise
        // a light flash precedes every page paint for dark-mode users.
        // eslint-disable-next-line react/no-danger -- static no-flash bootstrap
        dangerouslySetInnerHTML={{ __html: THEME_NOFLASH_SCRIPT }}
      />
      <div className="h-screen flex flex-col bg-bg text-text overflow-hidden">
        <TopBar user={me.user} orgs={me.orgs} activeOrgSlug={activeOrg.slug} />
        <div className="flex-1 flex min-h-0">
          <Sidebar
            envs={envs.map((e) => ({ slug: e.slug, name: e.name }))}
            activeEnvSlug={activeEnvSlug}
          />
          <main className="flex-1 overflow-y-auto min-w-0">{children}</main>
        </div>
      </div>
    </>
  );
}
