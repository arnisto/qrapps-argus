'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthCard } from '@/components/auth/AuthCard';
import { Field } from '@/components/auth/Field';
import { signin } from '@/lib/auth-client';

/**
 * Reject anything that isn't an obviously-safe same-origin relative path.
 * Blocks:
 *   · absolute URLs ("https://evil/…", "javascript:…")
 *   · protocol-relative ("//evil/…") — browsers treat these as absolute
 *   · backslash-tricks ("/\\evil/…") that some old browsers normalize away
 *   · anything that doesn't start with a single '/'
 */
function safeNext(raw: string | null): string {
  const fallback = '/dashboard';
  if (!raw) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

export default function SigninPage() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get('next'));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    try {
      await signin({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      });
      // Hard nav so the authed shell can re-render with the new session.
      // `next` has been normalized via safeNext() — guaranteed same-origin
      // relative path or the /environments fallback.
      window.location.href = next;
    } catch (err) {
      const code = (err as Error).message;
      setError(
        code === 'invalid_credentials'
          ? 'Email and password don’t match.'
          : 'Couldn’t sign in. Try again in a moment.',
      );
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Sign in to Argus"
      subtitle="Welcome back. One layer in front of every model you use."
      footer={
        <>
          New to Argus?{' '}
          <a href="/signup" className="text-blue hover:underline">
            Create an account
          </a>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          autoFocus
          required
          placeholder="you@company.com"
        />
        <Field
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
        {error ? (
          <div className="text-sm text-rose bg-rose/10 border border-rose/30 rounded-md px-3 py-2">
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center rounded-md bg-blue text-bg-0 font-semibold px-4 py-2.5 hover:opacity-90 disabled:opacity-50 transition"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  );
}
