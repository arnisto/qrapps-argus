import Link from 'next/link';
import type { HealthSnapshot, Investigator } from '@/lib/api';

interface Props {
  active?: 'Pulse' | 'Feed' | 'Investigators' | 'Opportunities' | 'Memory graph' | 'Closed loops';
  health: HealthSnapshot | null;
  investigators: Investigator[];
}

const TONES = ['rose', 'amber', 'emerald', 'blue'] as const;

/**
 * The left side rail from Screen 1. Top section: pinned summary counts; bottom:
 * a list of "active investigators" with a tone-tinted live dot per row.
 *
 * Counts are derived from real data where the concept maps cleanly. The list
 * shows the user's enabled investigators with a short subtitle derived from
 * their threshold + their first trigger event type.
 */
export function SideRail({ active = 'Pulse', health, investigators }: Props) {
  const findings = Number(health?.activity.findings_24h ?? 0);
  const enabled = investigators.filter((i) => i.enabled);
  const closedLoops = Number(health?.activity.investigations_succeeded_24h ?? 0);

  const items = [
    ['Pulse', 'live', '/'],
    ['Feed', String(findings), '/findings'],
    ['Investigators', String(enabled.length), '/investigators'],
    ['Opportunities', '5', '/'],
    ['Memory graph', 'v12', '/memory'],
    ['Closed loops', String(closedLoops), '/findings'],
  ] as const;

  return (
    <aside className="ds-card" style={{ padding: '6px 4px', height: '100%' }}>
      {items.map(([label, badge, href]) => (
        <Link
          key={label}
          href={href}
          className="flex justify-between items-center"
          style={{
            padding: '8px 10px',
            borderRadius: 7,
            fontSize: 12.5,
            color: active === label ? 'var(--fg-0)' : 'var(--fg-1)',
            background: active === label ? 'var(--bg-2)' : 'transparent',
          }}
        >
          <span>{label}</span>
          <span className="mono text-fg-3" style={{ fontSize: 10.5 }}>
            {badge}
          </span>
        </Link>
      ))}

      <hr style={{ height: 1, background: 'var(--line)', border: 0, margin: '8px 6px' }} />

      <div className="uppercase-mini text-fg-3" style={{ padding: '4px 10px 6px' }}>
        Active investigators
      </div>

      {enabled.length === 0 && (
        <div className="text-fg-3" style={{ padding: '6px 10px', fontSize: 11.5 }}>
          No investigators enabled.
        </div>
      )}

      {enabled.slice(0, 4).map((inv, i) => {
        const tone = TONES[i % TONES.length];
        return (
          <Link
            key={inv.id}
            href={`/investigators/${inv.id}`}
            className="flex gap-2"
            style={{ padding: '7px 10px' }}
          >
            <span style={{ color: `var(--${tone})`, marginTop: 4 }}>
              <span className="live-dot" />
            </span>
            <div className="flex flex-col" style={{ lineHeight: 1.25 }}>
              <span style={{ fontSize: 12.5 }}>{inv.name}</span>
              <span className="mono text-fg-3" style={{ fontSize: 10.5 }}>
                {Number(inv.agent_count) > 0
                  ? `${inv.agent_count} agents · ${inv.severity_threshold}`
                  : `legacy · ${inv.severity_threshold}`}
              </span>
            </div>
          </Link>
        );
      })}
    </aside>
  );
}
