/**
 * Full operational memory graph from Screen 5 of the design. Node and edge
 * positions copied verbatim — this is a representative graph (no backing
 * memory subsystem in v0.2). The selected node ("Weekend re-stock") is
 * highlighted with a halo + thicker stroke, and edges touching it are drawn
 * solid emerald.
 */
export function BigMemoryGraph() {
  const N = [
    { id: 1, x: 90, y: 220, r: 22, t: 'rose', l: 'Refund anomaly' },
    { id: 2, x: 200, y: 130, r: 16, t: 'amber', l: 'Vendor switch' },
    { id: 3, x: 320, y: 200, r: 26, t: 'blue', l: 'Damage tickets' },
    { id: 4, x: 460, y: 110, r: 18, t: 'blue', l: 'Margin model' },
    { id: 5, x: 560, y: 230, r: 24, t: 'emerald', l: 'Logistics audit', glow: true },
    { id: 6, x: 700, y: 130, r: 16, t: 'emerald', l: 'Memory v12' },
    { id: 7, x: 240, y: 320, r: 12, t: 'dim', l: 'Weather' },
    { id: 8, x: 470, y: 320, r: 14, t: 'amber', l: 'Carrier #3' },
    { id: 9, x: 100, y: 360, r: 10, t: 'dim', l: 'Seasonality' },
    { id: 10, x: 640, y: 340, r: 14, t: 'emerald', l: 'Weekend re-stock', selected: true },
    { id: 11, x: 380, y: 60, r: 10, t: 'dim', l: 'Region map' },
    { id: 12, x: 740, y: 250, r: 11, t: 'blue', l: 'Vendor risk v3' },
  ];
  const L: Array<[number, number]> = [
    [1, 2],
    [1, 3],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 6],
    [7, 3],
    [8, 5],
    [2, 5],
    [9, 1],
    [10, 5],
    [10, 3],
    [11, 2],
    [12, 5],
    [12, 4],
  ];
  const col = (t: string) => (t === 'dim' ? 'var(--fg-3)' : `var(--${t})`);
  const find = (id: number) => N.find((n) => n.id === id)!;

  return (
    <svg
      viewBox="0 0 820 420"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden
    >
      <defs>
        <radialGradient id="bigmem-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.72 0.15 158)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="oklch(0.72 0.15 158)" stopOpacity="0" />
        </radialGradient>
        <pattern id="bigmem-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path
            d="M32 0H0V32"
            stroke="oklch(0.27 0.012 250)"
            strokeOpacity="0.35"
            strokeWidth="0.5"
            fill="none"
          />
        </pattern>
      </defs>
      <rect width="820" height="420" fill="url(#bigmem-grid)" />

      {L.map(([a, b], i) => {
        const A = find(a);
        const B = find(b);
        const sel = A.selected || B.selected;
        return (
          <line
            key={i}
            x1={A.x}
            y1={A.y}
            x2={B.x}
            y2={B.y}
            stroke={sel ? 'var(--emerald)' : 'oklch(0.32 0.013 250)'}
            strokeWidth={sel ? 1.4 : 0.8}
            strokeDasharray={sel ? '0' : '3 3'}
            opacity={sel ? 0.9 : 0.65}
          />
        );
      })}

      {N.map((n) => (
        <g key={n.id}>
          {(n.glow || n.selected) && (
            <circle cx={n.x} cy={n.y} r={n.r + 12} fill="url(#bigmem-halo)" />
          )}
          <circle
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={`color-mix(in oklch, ${col(n.t)} ${n.selected ? 26 : 18}%, oklch(0.18 0.01 250))`}
            stroke={col(n.t)}
            strokeWidth={n.selected ? 2 : 1.2}
          />
          <text
            x={n.x}
            y={n.y + n.r + 13}
            textAnchor="middle"
            fill="oklch(0.82 0.006 250)"
            fontSize="10.5"
            fontFamily="Geist Mono, monospace"
          >
            {n.l}
          </text>
        </g>
      ))}

      {/* timeline curve along bottom — reasoning depth growing over time */}
      <path
        d="M 30 405 C 200 400, 320 395, 420 388 S 600 374, 790 360"
        stroke="var(--emerald)"
        strokeOpacity="0.8"
        strokeWidth="1.5"
        fill="none"
      />
      <text
        x="32"
        y="402"
        fill="oklch(0.46 0.010 250)"
        fontSize="10"
        fontFamily="Geist Mono, monospace"
      >
        apr 1
      </text>
      <text
        x="755"
        y="356"
        fill="var(--emerald)"
        fontSize="10"
        fontFamily="Geist Mono, monospace"
      >
        today · 4.2 hops
      </text>
    </svg>
  );
}
