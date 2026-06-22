'use client';

import Link from 'next/link';
import type { AuthedUser, Membership } from '@/lib/auth-client';
import { BrandMark, IconClose, IconMenu } from './icons';
import {
  GatewayPill,
  InitialsAvatar,
  OrgSwitcher,
  SelfHostedBadge,
} from './Atoms';
import { ThemeToggle } from './ThemeToggle';

interface Props {
  user: AuthedUser;
  orgs: Membership[];
  activeOrgSlug: string;
  /** Toggles the mobile sidebar slide-over. Provided by ClientShell. */
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

/**
 * 56px-tall sticky top bar. Mobile-first layout:
 *
 *   <md     hamburger + brand + spacer + avatar
 *   md+     adds: org switcher + self-hosted badge + LiteLLM pill
 *   lg+     adds: locale hint
 *
 * The hamburger is only rendered <md — at desktop widths the sidebar is
 * always visible so the control would be redundant.
 */
export function TopBar({ user, orgs, activeOrgSlug, onToggleSidebar, sidebarOpen }: Props) {
  return (
    <header className="flex-none h-14 border-b border-border bg-surface flex items-center gap-3 sm:gap-4 px-3 sm:px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        className="md:hidden flex-none w-9 h-9 rounded-md text-text-2 hover:text-text hover:bg-inset transition flex items-center justify-center"
      >
        {sidebarOpen ? <IconClose size={18} /> : <IconMenu size={18} />}
      </button>

      <Link href="/dashboard" className="flex items-center gap-2 text-text flex-none">
        <BrandMark size={22} />
        <span className="font-semibold tracking-tight text-base">Argus</span>
      </Link>

      <div className="hidden md:flex items-center gap-3">
        <OrgSwitcher orgs={orgs} activeSlug={activeOrgSlug} />
        <SelfHostedBadge />
      </div>
      <div className="hidden lg:flex items-center gap-3">
        <GatewayPill>LiteLLM → gemini-2.5-flash · gpt-4.1</GatewayPill>
      </div>

      <div className="flex-1" />

      <span className="hidden xl:inline font-mono text-xs text-text-3">
        EN · العربية (RTL)
      </span>
      <div className="hidden sm:block">
        <ThemeToggle />
      </div>
      <InitialsAvatar name={user.name} email={user.email} />
    </header>
  );
}
