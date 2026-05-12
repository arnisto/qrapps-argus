import type { CSSProperties, ReactNode } from 'react';

export type Tone = 'blue' | 'emerald' | 'amber' | 'rose' | 'neutral';

interface Props {
  tone?: Tone;
  dot?: boolean;
  size?: 'sm' | 'md';
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/**
 * Reproduces the design's `.chip` primitive — a 20px-tall pill with optional
 * coloured dot. Used everywhere from sidebar to top-bar to action buttons.
 */
export function Chip({ tone = 'neutral', dot = true, size = 'md', children, style, className = '' }: Props) {
  const toneClass = tone === 'neutral' ? '' : tone;
  const compact = size === 'sm' ? { height: 18, fontSize: 10.5 } : undefined;
  return (
    <span className={`chip ${toneClass} ${className}`.trim()} style={{ ...compact, ...style }}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

interface AgentBadgeProps {
  tone?: Tone;
  size?: number;
  children: ReactNode;
}

export function AgentBadge({ tone = 'neutral', size = 22, children }: AgentBadgeProps) {
  const toneClass = tone === 'neutral' ? '' : tone;
  const fontSize = size <= 18 ? 9 : size <= 22 ? 10 : size <= 26 ? 11 : 13;
  return (
    <span
      className={`ag ${toneClass}`.trim()}
      style={{ width: size, height: size, fontSize }}
    >
      {children}
    </span>
  );
}

export function LiveDot({ tone = 'blue' as Tone }) {
  const color =
    tone === 'neutral' ? 'var(--fg-3)' : `var(--${tone})`;
  return <span className="live-dot" style={{ color }} />;
}
