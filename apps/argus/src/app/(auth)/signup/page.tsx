import Link from 'next/link'
import { Field, Flash } from '@/components/ui'
import { SubmitButton } from '@/components/SubmitButton'
import { errorText, firstParam } from '@/lib/messages'
import { signUp } from '../actions'

export const metadata = { title: 'Create an account' }

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const error = errorText(firstParam((await searchParams).error))
  return (
    <>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      {error && <Flash tone="bad">{error}</Flash>}
      <form action={signUp} className="space-y-4">
        <Field label="Your name" name="name" autoComplete="name" required />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={8} hint="At least 8 characters." required />
        <SubmitButton className="w-full" pendingLabel="Creating…">
          Create account
        </SubmitButton>
      </form>
      <p className="text-sm text-muted">
        Already have one?{' '}
        <Link href="/login" className="text-accent underline">
          Sign in
        </Link>
      </p>
    </>
  )
}
