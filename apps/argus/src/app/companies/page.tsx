import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import { Card, Empty, Field, Flash, TextArea } from '@/components/ui'
import { SubmitButton } from '@/components/SubmitButton'
import { errorText, firstParam } from '@/lib/messages'
import type { Company } from '@/lib/db-types'
import { signOut } from '../(auth)/actions'
import { createCompany } from './actions'

export const metadata = { title: 'Companies' }

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const error = errorText(firstParam((await searchParams).error))
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: companies } = await supabase.from('companies').select('*').order('created_at').returns<Company[]>()

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">Argus</p>
          <h1 className="text-2xl font-semibold">Your companies</h1>
        </div>
        <form action={signOut} className="flex items-center gap-3 text-sm text-muted">
          <span>{user?.email}</span>
          <button className="underline">Sign out</button>
        </form>
      </header>

      {error && <Flash tone="bad">{error}</Flash>}

      {companies?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {companies.map((c) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}`} className="block rounded-lg border border-line bg-white p-4 hover:border-accent">
                <span className="block font-semibold">{c.name}</span>
                <span className="block text-sm text-muted">{[c.city, c.country].filter(Boolean).join(', ')}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No company yet. Create the first one below, for example Lovixa.</Empty>
      )}

      <Card title="Create a company">
        <form action={createCompany} className="space-y-4">
          <Field label="Name" name="name" placeholder="Lovixa" required minLength={2} maxLength={80} />
          <TextArea
            label="What does it do?"
            name="description"
            rows={3}
            maxLength={1000}
            placeholder="A web app friend groups in Tunis use to decide what to do together: vote, lock a plan, go."
            hint="Argus uses this to propose what to watch on Facebook."
          />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Country code" name="country" defaultValue="TN" maxLength={2} required />
            <Field label="City" name="city" placeholder="Tunis" />
          </div>
          <SubmitButton pendingLabel="Creating and proposing an objective…">Create company</SubmitButton>
        </form>
      </Card>
    </main>
  )
}
