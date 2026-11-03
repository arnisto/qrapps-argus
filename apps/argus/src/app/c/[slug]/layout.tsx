import Link from 'next/link'
import { loadCompany } from '@/lib/company'
import { signOut } from '../../(auth)/actions'

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { company } = await loadCompany(slug)
  const nav = [
    { href: `/c/${slug}`, label: 'Overview' },
    { href: `/c/${slug}/sources`, label: 'Sources' },
    { href: `/c/${slug}/reports`, label: 'Reports' },
  ]
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/companies" className="text-sm font-semibold uppercase tracking-wide text-accent">
            Argus
          </Link>
          <span className="font-semibold">{company.name}</span>
          <nav aria-label="Company" className="flex gap-1">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm hover:bg-paper">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action={signOut} className="ml-auto">
            <button className="text-sm text-muted underline">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">{children}</main>
    </div>
  )
}
