import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { ButtonLink } from '@/components/ui'

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect('/companies')

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">Argus</p>
      <h1 className="text-3xl font-semibold leading-tight">Your market on Facebook, read for you every day. Every claim backed by evidence.</h1>
      <p className="text-muted">
        Create your company, connect your Facebook page, confirm what Argus should watch. Argus collects posts and ads, keeps only real
        signals, and writes a short report where every number points to its source.
      </p>
      <div className="flex gap-3">
        <ButtonLink href="/signup">Create an account</ButtonLink>
        <ButtonLink href="/login" variant="secondary">
          Sign in
        </ButtonLink>
      </div>
    </main>
  )
}
