import type { ReactNode } from 'react';

/**
 * Auth route group layout — no sidebar, no top bar. Centered card on a
 * gradient backdrop. Fully responsive: card fills the viewport on mobile,
 * caps at a comfortable width on desktop.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Soft accent gradient — uses design tokens via color-mix. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent), radial-gradient(40% 30% at 20% 100%, color-mix(in srgb, var(--green) 8%, transparent), transparent)',
        }}
      />
      <header className="px-6 py-5 sm:px-10">
        <a href="/" className="inline-flex items-center gap-2 text-fg-0">
          <span aria-hidden className="text-[18px]">🛰️</span>
          <span className="font-semibold tracking-tight">Argus</span>
        </a>
      </header>
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 pb-12">
        <div className="w-full max-w-[440px]">{children}</div>
      </main>
      <footer className="px-6 pb-6 text-center text-2xs text-fg-3">
        Argus — your knowledge layer in front of any LLM.
      </footer>
    </div>
  );
}
