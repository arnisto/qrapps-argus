import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TopBar } from '@/components/ds/TopBar';

export const metadata: Metadata = {
  title: 'Argus — Operational Intelligence',
  description: 'AI-native operational observability and investigation platform.',
};

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
      <body className="min-h-screen antialiased">
        <TopBar />
        <main className="mx-auto max-w-[1480px] px-4 py-4">{children}</main>
      </body>
    </html>
  );
}
