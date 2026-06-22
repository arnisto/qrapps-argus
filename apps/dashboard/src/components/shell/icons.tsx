import type { SVGProps } from 'react';

/**
 * Inline SVG icons in the Argus Console design system. All use
 * `stroke="currentColor"` so they pick up the active nav color. Standard
 * stroke-width 1.5; the brand mark uses 1.6.
 *
 * Paths are hand-authored — no external icon library — to match the
 * design's specific geometry (slightly heavier strokes, custom shapes).
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...p }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...p,
  };
}

// ---- Brand mark (Argus logo) ----------------------------------------------
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="8.2" stroke="var(--accent)" strokeWidth="1.6" />
      <circle cx="11" cy="11" r="3" fill="var(--accent)" />
    </svg>
  );
}

// ---- Nav icons ------------------------------------------------------------
export function IconDashboard(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" />
    </svg>
  );
}

export function IconInbox(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 10v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
      <path d="M3 10l3-6h8l3 6" />
      <path d="M3 10h4l1.5 2h3L13 10h4" />
    </svg>
  );
}

export function IconChat(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-1-2V7a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

export function IconPipelines(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <line x1="8" y1="4" x2="8" y2="16" />
      <line x1="12.5" y1="4" x2="12.5" y2="16" />
    </svg>
  );
}

export function IconMembers(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="7" cy="7.5" r="2.5" />
      <circle cx="14" cy="7.5" r="2.2" />
      <path d="M2.5 16c.6-2.4 2.2-3.7 4.5-3.7s3.9 1.3 4.5 3.7" />
      <path d="M12.5 15.5c.4-1.9 1.7-3 3-3 1.4 0 2.2.7 2.5 1.9" />
    </svg>
  );
}

export function IconConnectors(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="6" y="8" width="8" height="8" rx="1.5" />
      <line x1="8.5" y1="3" x2="8.5" y2="8" />
      <line x1="11.5" y1="3" x2="11.5" y2="8" />
      <line x1="10" y1="16" x2="10" y2="18" />
    </svg>
  );
}

export function IconModels(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="5" y="5" width="10" height="10" rx="1" />
      <rect x="7.5" y="7.5" width="5" height="5" rx="0.5" />
      <line x1="3" y1="7.5" x2="5" y2="7.5" />
      <line x1="3" y1="12.5" x2="5" y2="12.5" />
      <line x1="15" y1="7.5" x2="17" y2="7.5" />
      <line x1="15" y1="12.5" x2="17" y2="12.5" />
      <line x1="7.5" y1="3" x2="7.5" y2="5" />
      <line x1="12.5" y1="3" x2="12.5" y2="5" />
      <line x1="7.5" y1="15" x2="7.5" y2="17" />
      <line x1="12.5" y1="15" x2="12.5" y2="17" />
    </svg>
  );
}

export function IconApi(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7.5 5.5 4 10l3.5 4.5" />
      <path d="M12.5 5.5 16 10l-3.5 4.5" />
    </svg>
  );
}

export function IconAgents(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="7" width="12" height="9" rx="2" />
      <circle cx="8" cy="11" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="0.8" fill="currentColor" stroke="none" />
      <line x1="10" y1="3" x2="10" y2="7" />
      <circle cx="10" cy="3" r="1" />
    </svg>
  );
}

export function IconChannels(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3.5 10h8" />
      <path d="M9 6l4 4-4 4" />
      <path d="M16 4v12" />
    </svg>
  );
}

export function IconKnowledge(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 5h5.5a2 2 0 0 1 2 2v9a1 1 0 0 1-1 1H4Z" />
      <path d="M16 5h-3.5a2 2 0 0 0-2 2v9a1 1 0 0 0 1 1H16Z" />
      <line x1="10" y1="5" x2="10" y2="17" />
    </svg>
  );
}

export function IconTeach(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M10 12V4" />
      <path d="M6.5 7.5 10 4l3.5 3.5" />
      <path d="M3 14v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

export function IconInterview(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M7.5 7.5a2.5 2.5 0 1 1 4 2 1.5 1.5 0 0 0-1.5 1.5" />
      <circle cx="10" cy="14.5" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSecurity(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M10 3 4 5v5c0 4 2.5 6.5 6 7 3.5-.5 6-3 6-7V5l-6-2Z" />
      <path d="M7.5 10l2 2 3.5-4" />
    </svg>
  );
}

export function IconAudit(p: IconProps) {
  return (
    <svg {...base(p)}>
      <line x1="4" y1="5" x2="16" y2="5" />
      <line x1="4" y1="10" x2="16" y2="10" />
      <line x1="4" y1="15" x2="16" y2="15" />
      <circle cx="6" cy="5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="9" cy="15" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <line x1="3" y1="6" x2="17" y2="6" />
      <line x1="3" y1="14" x2="17" y2="14" />
      <circle cx="7" cy="6" r="1.6" fill="var(--surface)" />
      <circle cx="13" cy="14" r="1.6" fill="var(--surface)" />
    </svg>
  );
}

// ---- Utility icons --------------------------------------------------------
export function IconChevronDown(p: IconProps) {
  return (
    <svg {...base({ size: 14, ...p })}>
      <path d="M5 7l5 5 5-5" />
    </svg>
  );
}

export function IconLock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" />
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <line x1="10" y1="4" x2="10" y2="16" />
      <line x1="4" y1="10" x2="16" y2="10" />
    </svg>
  );
}
