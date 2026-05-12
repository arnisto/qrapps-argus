/**
 * Compact memory graph from the right rail of Screen 1. The node positions
 * + connections are exact copies of the design source — this is a static
 * representation until we ship a real "Operational Memory" subsystem in a
 * future release. The full /memory page renders the larger version.
 */
export function MemoryGraphMini({ height = 150 }: { height?: number }) {
  const nodes = [
    { x: 50, y: 90, r: 12, t: 'rose', l: 'Refund pattern' },
    { x: 120, y: 50, r: 10, t: 'amber', l: 'Vendor switch' },
    { x: 200, y: 80, r: 14, t: 'blue', l: 'Damage tickets' },
    { x: 290, y: 45, r: 11, t: 'blue', l: 'Margin model' },
    { x: 360, y: 95, r: 13, t: 'emerald', l: 'Logistics audit' },
    { x: 430, y: 55, r: 10, t: 'emerald', l: 'Memory v12' },
    { x: 165, y: 130, r: 7, t: 'dim', l: 'Weather' },
    { x: 320, y: 130, r: 8, t: 'amber', l: 'Carrier #3' },
  ] as const;
  const links: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [6, 2],
    [7, 4],
    [1, 4],
  ];
  const col = (t: string) => (t === 'dim' ? 'var(--fg-3)' : `var(--${t})`);

  return (
    <svg
      viewBox={`0 0 480 ${height}`}
      style={{ width: '100%', height, display: 'block' }}
      aria-hidden
    >
      <defs>
        <pattern id="memg-mini" width="24" height="24" patternUnits="userSpaceOnUse">
          <path
            d="M24 0H0V24"
            stroke="oklch(0.27 0.012 250)"
            strokeOpacity="0.3"
            strokeWidth="0.5"
            fill="none"
          />
        </pattern>
      </defs>
      <rect width="480" height={height} fill="url(#memg-mini)" />
      {links.map(([a, b], i) => {
        const A = nodes[a]!;
        const B = nodes[b]!;
        return (
          <line
            key={i}
            x1={A.x}
            y1={A.y}
            x2={B.x}
            y2={B.y}
            stroke="oklch(0.32 0.013 250)"
            strokeWidth="0.8"
            strokeDasharray="3 3"
          />
        );
      })}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={`color-mix(in oklch, ${col(n.t)} 18%, oklch(0.18 0.01 250))`}
            stroke={col(n.t)}
            strokeWidth="1.2"
          />
          <text
            x={n.x}
            y={n.y + n.r + 11}
            textAnchor="middle"
            fill="oklch(0.62 0.008 250)"
            fontSize="9"
            fontFamily="Geist Mono, monospace"
          >
            {n.l}
          </text>
        </g>
      ))}
    </svg>
  );
}
