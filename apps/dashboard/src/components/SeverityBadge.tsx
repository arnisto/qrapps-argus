type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

const STYLES: Record<Severity, string> = {
  none: 'bg-slate-800 text-slate-400 border-slate-700',
  low: 'bg-sky-950 text-sky-300 border-sky-900',
  medium: 'bg-amber-950 text-amber-300 border-amber-900',
  high: 'bg-orange-950 text-orange-300 border-orange-900',
  critical: 'bg-red-950 text-red-300 border-red-900',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[severity]}`}
    >
      {severity}
    </span>
  );
}
