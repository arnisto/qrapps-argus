'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { AuthedUser, Membership } from '@/lib/auth-client';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import type { EnvOption } from './Atoms';

/**
 * Client wrapper that owns the responsive sidebar state. The server-side
 * `AppLayout` does the auth check + data fetch and hands user/orgs/envs
 * into here as plain props; the children (the page) are server-rendered.
 *
 * Layout rules:
 *   · md+  — sidebar is a fixed 228px flex column, always visible
 *   · <md  — sidebar is hidden; hamburger in TopBar opens a slide-over
 *           with a tap-out backdrop, auto-closes on nav
 */
export function ClientShell({
  user,
  orgs,
  activeOrgSlug,
  envs,
  activeEnvSlug,
  children,
}: {
  user: AuthedUser;
  orgs: Membership[];
  activeOrgSlug: string;
  envs: EnvOption[];
  activeEnvSlug?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close the slide-over whenever the route changes (link in sidebar tapped).
  useEffect(() => setSidebarOpen(false), [pathname]);

  // Lock body scroll while the slide-over is open so behind-content doesn't
  // jiggle the chat or forms.
  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen]);

  return (
    <div className="h-[100dvh] flex flex-col bg-bg text-text overflow-hidden">
      <TopBar
        user={user}
        orgs={orgs}
        activeOrgSlug={activeOrgSlug}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        sidebarOpen={sidebarOpen}
      />
      <div className="flex-1 flex min-h-0 relative">
        {/* Desktop sidebar — always there at md+, never on mobile */}
        <div className="hidden md:flex flex-none">
          <Sidebar envs={envs} activeEnvSlug={activeEnvSlug} />
        </div>

        {/* Mobile slide-over backdrop */}
        {sidebarOpen ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
            className="md:hidden fixed inset-0 z-30 bg-text/40 animate-fade"
          />
        ) : null}

        {/* Mobile slide-over panel */}
        <div
          className={[
            'md:hidden fixed inset-y-0 left-0 z-40 w-[260px] max-w-[85vw]',
            'transition-transform duration-200 ease-out',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
        >
          <Sidebar envs={envs} activeEnvSlug={activeEnvSlug} />
        </div>

        <main className="flex-1 overflow-y-auto min-w-0">{children}</main>
      </div>
    </div>
  );
}
