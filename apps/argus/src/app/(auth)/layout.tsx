import Link from 'next/link'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <Link href="/" className="text-sm font-semibold uppercase tracking-wide text-accent">
        Argus
      </Link>
      {children}
    </main>
  )
}
