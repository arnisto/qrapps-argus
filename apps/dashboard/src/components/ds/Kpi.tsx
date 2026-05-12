import { Sparkline } from './Sparkline';
import type { Tone } from './Chip';

interface Props {
  tone: Tone;
  label: string;
  val: string;
  sub: string;
  spark: number[];
}

/**
 * One KPI tile from the exec strip. The strip is a row of 4 of these, divided
 * by 1px lines. Each tile owns its tone (rose for risks, emerald for opps,
 * blue for closed loops, amber for reasoning health) and renders a colour-
 * matched sparkline.
 */
export function Kpi({ tone, label, val, sub, spark }: Props) {
  const color = tone === 'neutral' ? 'var(--fg-2)' : `var(--${tone})`;
  return (
    <div
      className="grow flex flex-col gap-2 min-w-0"
      style={{ padding: '14px 16px', borderLeft: '1px solid var(--line)' }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color }}>
          <span className="live-dot" />
        </span>
        <span className="uppercase-mini text-fg-2">{label}</span>
      </div>
      <div className="flex items-end gap-3">
        <span
          className="mono"
          style={{
            fontSize: 22,
            letterSpacing: '-0.02em',
            color,
            fontWeight: 600,
          }}
        >
          {val}
        </span>
        <Sparkline vals={spark} tone={tone} />
      </div>
      <span className="mono text-fg-3" style={{ fontSize: 11 }}>
        {sub}
      </span>
    </div>
  );
}
