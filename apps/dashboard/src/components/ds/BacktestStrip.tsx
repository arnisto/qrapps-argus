/**
 * 90-day backtest strip from Screen 4 of the design. Renders a horizontal
 * timeline with tick marks and "fire" markers (vertical bars + dots) at the
 * days an investigator would have triggered. Default seed: 7 fires across
 * 90 days. Used until we wire a real backtest endpoint (v0.3).
 */
interface Props {
  /** Day indices (0..89) where the investigator would have fired. */
  fires?: number[];
}

export function BacktestStrip({ fires = [4, 18, 29, 41, 55, 68, 84] }: Props) {
  const days = 90;
  const W = 720;
  const H = 70;
  const p = 12;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <line
        x1={p}
        x2={W - p}
        y1={H / 2}
        y2={H / 2}
        stroke="oklch(0.27 0.012 250)"
        strokeWidth="1"
      />
      {Array.from({ length: days }).map((_, i) => (
        <line
          key={i}
          x1={p + (i / (days - 1)) * (W - p * 2)}
          x2={p + (i / (days - 1)) * (W - p * 2)}
          y1={H / 2 - 3}
          y2={H / 2 + 3}
          stroke="oklch(0.27 0.012 250)"
          strokeWidth="0.5"
        />
      ))}
      {fires.map((d, i) => {
        const x = p + (d / (days - 1)) * (W - p * 2);
        return (
          <g key={i}>
            <line
              x1={x}
              x2={x}
              y1={H / 2 - 22}
              y2={H / 2 - 3}
              stroke="oklch(0.68 0.18 22)"
              strokeWidth="1.5"
            />
            <circle cx={x} cy={H / 2 - 24} r="3.5" fill="oklch(0.68 0.18 22)" />
          </g>
        );
      })}
      <text
        x={p}
        y={H - 4}
        fill="oklch(0.46 0.010 250)"
        fontFamily="Geist Mono, monospace"
        fontSize="10"
      >
        90 days ago
      </text>
      <text
        x={W - p - 30}
        y={H - 4}
        fill="oklch(0.46 0.010 250)"
        fontFamily="Geist Mono, monospace"
        fontSize="10"
      >
        today
      </text>
    </svg>
  );
}
