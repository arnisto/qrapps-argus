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

const GROUPS: NavGroup[] = [
  {
    label: 'Operate',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: IconDashboard },
      { label: 'Inbox', href: '/inbox', icon: IconInbox },
      { label: 'Ask Argus', href: '/ask', icon: IconChat },
    ],
  },
  {
    label: 'Teams',
    items: [
      { label: 'Pipelines', href: '/pipelines', icon: IconPipelines },
      { label: 'Members', href: '/members', icon: IconMembers },
    ],
  },
  {
    label: 'Engine',
    items: [
      { label: 'Environments', href: '/environments', icon: IconConnectors },
      { label: 'Connectors', href: '/connectors', icon: IconConnectors, hint: 'in' },
      { label: 'Models', href: '/models', icon: IconModels },
      { label: 'Developer API', href: '/developer-api', icon: IconApi },
      { label: 'Agents & tools', href: '/agents', icon: IconAgents },
      { label: 'Channels', href: '/channels', icon: IconChannels, hint: 'out' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { label: 'Knowledge core', href: '/knowledge', icon: IconKnowledge },
      { label: 'Teach Argus', href: '/teach', icon: IconTeach },
      { label: 'Interview', href: '/interview', icon: IconInterview },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Security', href: '/security', icon: IconSecurity },
      { label: 'Audit log', href: '/audit', icon: IconAudit },
      { label: 'Settings', href: '/settings', icon: IconSettings },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
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
      className="flex-none w-[228px] border-r border-border bg-surface flex flex-col"
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
                  href={item.href}
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
