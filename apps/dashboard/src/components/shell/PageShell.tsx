import type { ReactNode } from 'react';

/**
 * Inner-page chrome. Holds page padding, max-width, the h1 + subtitle
 * pattern from the design. Use inside AppLayout's main slot.
 */
export function PageShell({
  title,
  subtitle,
  actions,
  children,
  maxWidth = '1080px',
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-8" style={{ maxWidth, margin: '0 auto' }}>
      <div className="flex items-end justify-between gap-3 sm:gap-4 flex-wrap mb-5 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-text">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-text-2 mt-1 text-sm sm:text-base max-w-prose">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-2 flex-wrap">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Placeholder card used by stub pages until M5+ wires their real data.
 * Has the proper visual weight so it doesn't read as broken.
 */
export function StubCard({
  title,
  body,
}: {
  title: string;
  body: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-6">
      <div className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-2">
        {title}
      </div>
      <div className="text-base text-text-2 leading-relaxed">{body}</div>
    </div>
  );
}
