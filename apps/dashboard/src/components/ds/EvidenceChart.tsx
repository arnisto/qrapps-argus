/**
 * Evidence chart — area chart with a baseline + actual line + annotation line.
 * Default data shape: 14 days of values + a labelled "vendor switch" point.
 * Optional `points` lets the caller supply real time-bucketed evidence.
 *
 * Mirrors `EvidenceChart` from the design source verbatim.
 */
interface Props {
  /** Optional override; defaults to a synthetic "refund spike" pattern. */
  points?: number[];
  annotationIndex?: number;
  annotationLabel?: string;
  endLabel?: string;
}

export function EvidenceChart({
  points,
  annotationIndex = 10.5,
  annotationLabel = 'Apr 28 · vendor switch',
  endLabel = '+312% vs baseline',
}: Props) {
  const days = 14;
  const base = points && points.length === days
    ? points
    : Array.from({ length: days }, (_, i) => 60 + Math.round(Math.sin(i / 2) * 10) + i * 1.5);
  const spike = base.map((v, i) => (i < 11 ? v : v + (i - 10) * 70));
  const W = 600;
  const H = 180;
  const p = 24;
  const max = Math.max(...spike);
  const min = Math.min(...base);
  const r = max - min || 1;
  const px = (i: number) => p + (i / (days - 1)) * (W - p * 2);
  const py = (v: number) => H - p - ((v - min) / r) * (H - p * 2);
  const path = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${px(i)} ${py(v)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="evi-rose" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.68 0.18 22)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="oklch(0.68 0.18 22)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={p}
          x2={W - p}
          y1={p + (i * (H - p * 2)) / 3}
          y2={p + (i * (H - p * 2)) / 3}
          stroke="oklch(0.27 0.012 250)"
          strokeOpacity="0.4"
          strokeWidth="0.5"
        />
      ))}

      {/* baseline */}
      <path
        d={`${path(base)} L ${px(days - 1)} ${H - p} L ${px(0)} ${H - p} Z`}
        fill="oklch(0.62 0.008 250)"
        opacity="0.1"
      />
      <path d={path(base)} stroke="oklch(0.62 0.008 250)" strokeWidth="1" fill="none" strokeDasharray="3 3" />

      {/* actual */}
      <path
        d={`${path(spike)} L ${px(days - 1)} ${H - p} L ${px(0)} ${H - p} Z`}
        fill="url(#evi-rose)"
      />
      <path d={path(spike)} stroke="oklch(0.68 0.18 22)" strokeWidth="1.6" fill="none" />

      {/* annotation */}
      <line
        x1={px(annotationIndex)}
        x2={px(annotationIndex)}
        y1={p}
        y2={H - p}
        stroke="oklch(0.78 0.14 78)"
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      <text
        x={px(annotationIndex) + 6}
        y={p + 12}
        fill="oklch(0.78 0.14 78)"
        fontFamily="Geist Mono, monospace"
        fontSize="10"
      >
        {annotationLabel}
      </text>
      <text
        x={px(days - 1) - 80}
        y={py(spike[days - 1]!) - 8}
        fill="oklch(0.68 0.18 22)"
        fontFamily="Geist Mono, monospace"
        fontSize="11"
      >
        {endLabel}
      </text>
      <text
        x={p}
        y={H - 6}
        fill="oklch(0.46 0.010 250)"
        fontFamily="Geist Mono, monospace"
        fontSize="10"
      >
        14 days
      </text>
      <text
        x={W - p - 40}
        y={H - 6}
        fill="oklch(0.46 0.010 250)"
        fontFamily="Geist Mono, monospace"
        fontSize="10"
      >
        today
      </text>
    </svg>
  );
}
