import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Argus', template: '%s · Argus' },
  description: 'Argus watches your market on Facebook and reports what matters, with evidence.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Extensions (e.g. ColorZilla) add attributes to <body> before hydration. */}
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
