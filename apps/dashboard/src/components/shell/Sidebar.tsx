'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';
import { EnvSwitcher, GuardrailsCard, type EnvOption } from './Atoms';
import {
  IconAgents,
  IconApi,
  IconAudit,
  IconChannels,
  IconChat,
  IconConnectors,
  IconDashboard,
  IconInbox,
  IconInterview,
  IconKnowledge,
  IconMembers,
  IconModels,
  IconPipelines,
  IconSecurity,
  IconSettings,
  IconTeach,
} from './icons';

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface NavItem {
  label: string;
  href: string;
  icon: IconCmp;
  badge?: { text: string; tone: 'accent' | 'green' | 'red' };
  hint?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * For the buyer demo we expose only the routes whose backends are real.
 * The 10 stubs (Inbox / Pipelines / Members / Connectors / Agents /
 * Channels / Knowledge core / Interview / Security / Audit log /
 * Settings) live in `src/app/<route>/page.tsx` and ship as
 * "milestones in M5/M6" cards — perfectly fine pages, but a stray click
 * on stage reads as vaporware. Re-enable them in the SHOW_ALL block as
 * each backend lands.
 */
const GROUPS: NavGroup[] = [
  {
    label: 'Operate',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: IconDashboard },
      { label: 'Ask Argus', href: '/ask', icon: IconChat },
    ],
  },
  {
    label: 'Engine',
    items: [
      { label: 'Environments', href: '/environments', icon: IconConnectors },
      { label: 'Models', href: '/models', icon: IconModels },
      { label: 'Connectors', href: '/connectors', icon: IconConnectors, hint: 'in' },
      { label: 'Channels', href: '/channels', icon: IconChannels, hint: 'out' },
      { label: 'Developer API', href: '/developer-api', icon: IconApi },
    ],
  },
  {
    label: 'Operate',
    items: [
      { label: 'Automations', href: '/automations', icon: IconPipelines, hint: 'cron' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { label: 'Teach Argus', href: '/teach', icon: IconTeach },
    ],
  },
  {
    label: 'Team',
    items: [
      { label: 'Members', href: '/members', icon: IconMembers },
    ],
  },
];

// SHOW_ALL controls whether the 9 placeholder routes get a nav row. Set
// NEXT_PUBLIC_SHOW_ALL=1 in .env.local to expose them for development.
// Kept here so the icon imports don't go stale.
void [IconInbox, IconPipelines, IconAgents, IconChannels, IconKnowledge, IconInterview, IconSecurity, IconAudit, IconSettings];

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * Routes that scope their data per-env (read `?env=<slug>` server-side).
 * For these, the sidebar appends the active env so switching pages doesn't
 * silently change the env context — biggest demo-day footgun called out by
 * UX review.
 *
 * Top-level routes that don't accept ?env= (/environments, /dashboard) are
 * excluded so we don't push noise into their URLs.
 */
const ENV_SCOPED = new Set([
  '/models', '/teach', '/developer-api', '/ask',
  '/connectors', '/channels', '/automations',
]);

function hrefWithEnv(href: string, activeEnvSlug?: string): string {
  if (!activeEnvSlug) return href;
  return ENV_SCOPED.has(href) ? `${href}?env=${encodeURIComponent(activeEnvSlug)}` : href;
}

export function Sidebar({
  envs,
  activeEnvSlug,
}: {
  envs: EnvOption[];
  activeEnvSlug?: string;
}) {
  const pathname = usePathname();
  return (
    <aside
      // Width comes from the parent slot: 228px in the desktop column,
      // 100% inside the mobile slide-over panel. That way one component
      // works in both contexts without inner / outer width fights.
      className="w-full md:w-[228px] h-full border-r border-border bg-surface flex flex-col"
      style={{ minHeight: '0' }}
    >
      <div className="p-3 pb-2">
        <EnvSwitcher envs={envs} activeSlug={activeEnvSlug} />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {GROUPS.map((g, gi) => (
          <div key={g.label} className={gi === 0 ? '' : 'pt-3'}>
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-3">
              {g.label}
            </div>
            {g.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={hrefWithEnv(item.href, activeEnvSlug)}
                  className={[
                    'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-sm mb-0.5 transition',
                    active
                      ? 'bg-accent-soft text-accent font-semibold'
                      : 'text-text-2 hover:bg-inset hover:text-text font-medium',
                  ].join(' ')}
                >
                  <Icon size={18} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span
                      className={[
                        'font-mono text-2xs font-semibold min-w-[18px] text-center px-1 py-px rounded-lg',
                        item.badge.tone === 'accent'
                          ? 'bg-accent text-white'
                          : item.badge.tone === 'green'
                            ? 'bg-green-soft text-green'
                            : 'bg-red-soft text-red',
                      ].join(' ')}
                    >
                      {item.badge.text}
                    </span>
                  ) : null}
                  {item.hint ? (
                    <span className="font-mono text-2xs text-text-3">{item.hint}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="p-3 pt-2 border-t border-border">
        <GuardrailsCard />
      </div>
    </aside>
  );
}
