import Link from 'next/link'
import { Field, Flash } from '@/components/ui'
import { SubmitButton } from '@/components/SubmitButton'
import { errorText, firstParam } from '@/lib/messages'
import { signIn } from '../actions'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const error = errorText(firstParam(sp.error))
  const ok = firstParam(sp.ok)
  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {error && <Flash tone="bad">{error}</Flash>}
      {ok === 'check_email' && <Flash tone="info">Check your inbox and click the confirmation link, then sign in.</Flash>}
      <form action={signIn} className="space-y-4">
        <input type="hidden" name="next" value={firstParam(sp.next) ?? ''} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
      <p className="text-sm text-muted">
        No account?{' '}
        <Link href="/signup" className="text-accent underline">
          Create one
        </Link>
      </p>
    </>
  )
}
