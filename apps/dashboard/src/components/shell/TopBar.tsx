'use client';

import Link from 'next/link';
import type { AuthedUser, Membership } from '@/lib/auth-client';
import { BrandMark } from './icons';
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
}

/**
 * 56px-tall sticky top bar. Brand · org switcher · self-hosted badge ·
 * LiteLLM gateway pill · spacer · locale hint · theme toggle · avatar.
 */
export function TopBar({ user, orgs, activeOrgSlug }: Props) {
  return (
    <header className="flex-none h-14 border-b border-border bg-surface flex items-center gap-4 px-4">
      <Link href="/dashboard" className="flex items-center gap-2 text-text">
        <BrandMark size={22} />
        <span className="font-semibold tracking-tight text-base">Argus</span>
      </Link>
      <OrgSwitcher orgs={orgs} activeSlug={activeOrgSlug} />
      <SelfHostedBadge />
      <GatewayPill>LiteLLM → gemini-2.5-flash · gpt-4.1</GatewayPill>
      <div className="flex-1" />
      <span className="font-mono text-xs text-text-3 hidden md:inline">
        EN · العربية (RTL)
      </span>
      <ThemeToggle />
      <InitialsAvatar name={user.name} email={user.email} />
    </header>
  );
}
