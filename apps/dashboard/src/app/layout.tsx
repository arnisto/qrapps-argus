import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Argus — Knowledge layer for any LLM',
  description:
    'Argus puts a knowledge layer in front of any LLM: connect models, train them with your files and Q&A, then call them via an OpenAI-compatible API that injects citations.',
};

/**
 * Minimal root layout — chrome lives in route-group layouts:
 *   · (auth)/layout.tsx — centered card for sign-in / sign-up
 *   · (app)/layout.tsx  — authed shell with top bar + sidebar (later milestone)
 *
 * Legacy v0.2 pages (investigators, agents, findings, …) still mount at the
 * root and render without chrome — they will be migrated into (app)/ or
 * retired in a later milestone.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-screen antialiased bg-bg-0 text-fg-0">{children}</body>
    </html>
  );
}
