import type { ReactNode } from 'react';
import { AppLayout } from './AppLayout';
import { PageShell } from './PageShell';

/**
 * Convenience renderer for the nav targets whose backends ship in M5/M6.
 * Renders inside the proper authed shell + the design's H1 + a styled card
 * so the page feels intentional, not broken.
 */
export function StubPage({
  href,
  title,
  subtitle,
  body,
  milestone,
}: {
  href: string;
  title: string;
  subtitle: string;
  body: ReactNode;
  milestone: 'M5' | 'M6';
}) {
  return (
    <AppLayout redirectTarget={href}>
      <PageShell title={title} subtitle={subtitle}>
        <div className="rounded-2xl border border-border bg-surface shadow-card p-6 sm:p-8">
          <div className="inline-flex items-center gap-1.5 font-mono text-2xs font-semibold uppercase tracking-wider text-amber bg-amber-soft px-2 py-0.5 rounded-sm mb-4">
            ships in {milestone}
          </div>
          <div className="text-base text-text-2 leading-relaxed max-w-prose">
            {body}
          </div>
        </div>
      </PageShell>
    </AppLayout>
  );
}
