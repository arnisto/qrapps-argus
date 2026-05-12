/**
 * The Argus eye / orbit-circle brand mark. Reproduced from the design spec —
 * a small jewel-blue disc with an outlined inner circle and a center dot.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        position: 'relative',
        display: 'inline-block',
        background:
          'radial-gradient(circle at 30% 30%, oklch(0.85 0.16 250), oklch(0.45 0.16 250) 60%, oklch(0.22 0.05 250))',
        boxShadow:
          '0 0 0 1px oklch(0.55 0.16 250 / 0.55), 0 0 14px oklch(0.55 0.16 250 / 0.3)',
      }}
    >
      <span
        style={{
          content: '""',
          position: 'absolute',
          inset: Math.max(4, Math.round(size * 0.23)),
          borderRadius: '50%',
          border: '1px solid oklch(0.95 0.02 250 / 0.7)',
          background:
            'radial-gradient(circle, oklch(0.95 0.02 250) 0 1.3px, transparent 2px)',
        }}
      />
    </span>
  );
}
