'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Field } from '@/components/auth/Field';
import { signin, signup } from '@/lib/auth-client';

interface InvitePreview {
  invited_email: string;
  role: 'owner' | 'admin' | 'member';
  org: { slug: string; name: string };
  invited_by_email: string | null;
  expires_at: string;
}

interface CurrentUser {
  email: string;
  name: string | null;
}

type Mode = 'authed' | 'signin' | 'signup';

export function AcceptInviteForm({
  token,
  invite,
  currentUser,
}: {
  token: string;
  invite: InvitePreview;
  currentUser: CurrentUser | null;
}) {
  const [mode, setMode] = useState<Mode>(currentUser ? 'authed' : 'signup');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function postAccept(): Promise<void> {
    const res = await fetch(
      `/be/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST', credentials: 'include' },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `accept failed (${res.status})`);
    }
  }

  async function onAuthedAccept() {
    setSubmitting(true);
    setError(null);
    try {
      await postAccept();
      window.location.href = '/dashboard';
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  async function onSigninSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await signin({
        email: String(f.get('email') ?? ''),
        password: String(f.get('password') ?? ''),
      });
      await postAccept();
      window.location.href = '/dashboard';
    } catch (err) {
      setError(
        (err as Error).message === 'invalid_credentials'
          ? 'Email and password don’t match.'
          : (err as Error).message,
      );
      setSubmitting(false);
    }
  }

  async function onSignupSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await signup({
        email: String(f.get('email') ?? ''),
        password: String(f.get('password') ?? ''),
        name: (f.get('name') as string) || undefined,
      });
      await postAccept();
      window.location.href = '/dashboard';
    } catch (err) {
      const e2 = err as Error & { payload?: { error?: string } };
      setError(
        e2.payload?.error === 'email_already_registered'
          ? 'An account exists for that email — switch to "I already have an account".'
          : e2.message,
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-7 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">
        Join <span className="text-accent">{invite.org.name}</span>
      </h1>
      <p className="text-text-2 text-sm mt-2">
        {invite.invited_by_email ? (
          <>
            <strong>{invite.invited_by_email}</strong> invited{' '}
            <strong>{invite.invited_email}</strong> as{' '}
          </>
        ) : (
          <>You were invited as </>
        )}
        <span className="font-mono text-xs uppercase tracking-wider text-text bg-inset px-1.5 py-0.5 rounded-sm">
          {invite.role}
        </span>
        .
      </p>

      <div className="my-5 h-px bg-border" />

      {mode === 'authed' && currentUser ? (
        <div>
          <p className="text-sm text-text-2 mb-4">
            You're signed in as <strong>{currentUser.email}</strong>. Accept the
            invite and you'll be added to <strong>{invite.org.name}</strong>{' '}
            immediately.
          </p>
          <button
            type="button"
            onClick={onAuthedAccept}
            disabled={submitting}
            className="w-full rounded-md bg-accent text-white font-semibold px-4 py-2.5 text-sm hover:opacity-90 disabled:opacity-50 transition"
          >
            {submitting ? 'Joining…' : `Join ${invite.org.name}`}
          </button>
        </div>
      ) : mode === 'signup' ? (
        <form onSubmit={onSignupSubmit} className="space-y-3" noValidate>
          <Field name="name" label="Your name" autoComplete="name" placeholder="Lamjed Gaidi" />
          <Field
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            defaultValue={invite.invited_email}
            required
          />
          <Field
            name="password"
            type="password"
            label="Password"
            autoComplete="new-password"
            minLength={8}
            placeholder="At least 8 characters"
            required
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-accent text-white font-semibold px-4 py-2.5 text-sm hover:opacity-90 disabled:opacity-50 transition"
          >
            {submitting ? 'Creating account…' : `Create account & join ${invite.org.name}`}
          </button>
        </form>
      ) : (
        <form onSubmit={onSigninSubmit} className="space-y-3" noValidate>
          <Field
            name="email"
            type="email"
            label="Email"
            autoComplete="username"
            defaultValue={invite.invited_email}
            required
          />
          <Field
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-accent text-white font-semibold px-4 py-2.5 text-sm hover:opacity-90 disabled:opacity-50 transition"
          >
            {submitting ? 'Signing in…' : `Sign in & join ${invite.org.name}`}
          </button>
        </form>
      )}

      {error ? (
        <div className="mt-3 text-sm text-red bg-red-soft border border-red/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}

      {mode !== 'authed' ? (
        <div className="text-center text-xs text-text-3 mt-5">
          {mode === 'signup' ? (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('signin')}
                className="text-accent hover:underline"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="text-accent hover:underline"
              >
                Create an account
              </button>
            </>
          )}
        </div>
      ) : null}

      {currentUser && mode === 'authed' ? (
        <div className="text-center text-xs text-text-3 mt-5">
          Not you?{' '}
          <Link href="/signin" className="text-accent hover:underline">
            Sign in as someone else
          </Link>
        </div>
      ) : null}
    </div>
  );
}
