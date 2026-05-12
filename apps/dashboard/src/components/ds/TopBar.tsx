'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { Chip, AgentBadge } from './Chip';

/**
 * The Argus top bar — replaces the old simple nav. Active state is derived
 * from the current pathname so each route's primary section is highlighted
 * automatically.
 *
 * Nav entries match the design's nav set; secondary entries (Agents,
 * Connectors, Channels, Health) are appended on the right so they're
 * discoverable but visually subordinate to the canonical "operating loop".
 */
const PRIMARY_NAV = [
  { label: 'Today', href: '/' },
  { label: 'Investigators', href: '/investigators' },
  { label: 'Memory', href: '/memory' },
  { label: 'Workbench', href: '/agents' },
  { label: 'Loops', href: '/findings' },
] as const;

const SECONDARY_NAV = [
  { label: 'Connectors', href: '/connectors' },
  { label: 'Channels', href: '/channels' },
  { label: 'Credentials', href: '/credentials' },
  { label: 'Health', href: '/health' },
] as const;

export function TopBar() {
  const path = usePathname() ?? '/';

  const isActive = (href: string): boolean => {
    if (href === '/') return path === '/';
    return path === href || path.startsWith(href + '/');
  };

  return (
    <div
      className="flex items-center gap-3.5"
      style={{
        padding: '10px 18px',
        height: 48,
        borderBottom: '1px solid var(--line)',
        background: 'color-mix(in oklch, var(--bg-0) 88%, transparent)',
        position: 'sticky',
        top: 0,
        zIndex: 30,
        backdropFilter: 'blur(8px)',
      }}
    >
      <Link href="/" className="flex items-center gap-2.5 font-semibold">
        <BrandMark />
        <span>Argus</span>
        <span className="mono text-fg-3" style={{ fontSize: 11, fontWeight: 400 }}>
          / operational intelligence
        </span>
      </Link>
      <span
        style={{
          width: 1,
          background: 'var(--line)',
          alignSelf: 'stretch',
          height: 22,
          margin: '0 4px',
        }}
      />
      <nav className="flex gap-0.5 ml-1.5">
        {PRIMARY_NAV.map((n) => (
          <Link
            key={n.label}
            href={n.href}
            className={`px-2.5 py-1 rounded-md font-medium ${
              isActive(n.href)
                ? 'text-fg-0 bg-bg-2'
                : 'text-fg-2 hover:text-fg-1'
            }`}
            style={{ fontSize: 12.5 }}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1" />
      <nav className="flex gap-0.5" aria-label="Settings">
        {SECONDARY_NAV.map((n) => (
          <Link
            key={n.label}
            href={n.href}
            className={`px-2 py-1 rounded-md ${
              isActive(n.href) ? 'text-fg-0 bg-bg-2' : 'text-fg-3 hover:text-fg-1'
            }`}
            style={{ fontSize: 11.5 }}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <Chip tone="emerald">all systems</Chip>
      <AgentBadge tone="emerald">SR</AgentBadge>
    </div>
  );
}
