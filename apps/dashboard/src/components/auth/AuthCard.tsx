import type { ReactNode } from 'react';

/**
 * Shared chrome around sign-in / sign-up forms. Keeps both pages visually
 * identical so users don't perceive a context switch when toggling between
 * them.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="bg-bg-1 border border-line rounded-xl shadow-2xl shadow-black/40 p-7 sm:p-8">
      <h1 className="text-[20px] sm:text-[22px] font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="text-fg-2 text-sm mt-1.5">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 text-sm text-fg-2 text-center">{footer}</div> : null}
    </div>
  );
}
