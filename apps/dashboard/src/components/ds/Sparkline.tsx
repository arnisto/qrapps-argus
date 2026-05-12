import type { Tone } from './Chip';

interface Props {
  vals: number[];
  tone?: Tone;
  w?: number;
  h?: number;
}

/**
 * Tiny inline line+area chart, vector. Matches the design source exactly.
 * Uses currentColor so the tone (passed via the `<svg>` style) drives the
 * stroke and fill opacity.
 */
export function Sparkline({ vals, tone = 'blue', w = 110, h = 26 }: Props) {
  if (vals.length === 0) {
    return <svg width={w} height={h} aria-hidden />;
  }
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const r = Math.max(max - min, 1);
  const path = vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i / (vals.length - 1)) * w} ${h - ((v - min) / r) * h}`)
    .join(' ');
  const color = tone === 'neutral' ? 'var(--fg-2)' : `var(--${tone})`;
  return (
    <svg width={w} height={h} aria-hidden style={{ color }}>
      <path d={path} stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill="currentColor" opacity="0.12" />
    </svg>
  );
}
