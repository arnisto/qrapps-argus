'use client';

import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth/AuthCard';
import { Field } from '@/components/auth/Field';
import { signup, type AuthError } from '@/lib/auth-client';

type FieldErrors = Partial<Record<'email' | 'password' | 'name' | 'org_name', string>>;

export default function SignupPage() {
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTopError(null);
    setFieldErrors({});
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    try {
      await signup({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        name: (form.get('name') as string) || undefined,
        org_name: (form.get('org_name') as string) || undefined,
      });
      window.location.href = '/dashboard';
    } catch (err) {
      const e2 = err as Error & { status?: number; payload?: AuthError };
      if (e2.payload?.error === 'email_already_registered') {
        setFieldErrors({ email: 'An account with this email already exists.' });
      } else if (e2.payload?.issues?.length) {
        const next: FieldErrors = {};
        for (const issue of e2.payload.issues) {
          const k = issue.path[0] as keyof FieldErrors | undefined;
          if (k) next[k] = issue.message;
        }
        setFieldErrors(next);
      } else {
        setTopError('Couldn’t create your account. Try again in a moment.');
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your Argus account"
      subtitle="You'll get a personal workspace to spin up your first environment."
      footer={
        <>
          Already have an account?{' '}
          <a href="/signin" className="text-blue hover:underline">
            Sign in
          </a>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          name="name"
          label="Your name"
          autoComplete="name"
          placeholder="Lamjed Gaidi"
          error={fieldErrors.name}
        />
        <Field
          name="email"
          type="email"
          label="Work email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          error={fieldErrors.email}
        />
        <Field
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
          hint={fieldErrors.password ? undefined : 'Min. 8 characters. Mix it up.'}
          error={fieldErrors.password}
        />
        <Field
          name="org_name"
          label="Workspace name (optional)"
          placeholder="e.g. Speedo Delivery"
          hint="If empty, we'll name it after you."
          error={fieldErrors.org_name}
        />
        {topError ? (
          <div className="text-sm text-rose bg-rose/10 border border-rose/30 rounded-md px-3 py-2">
            {topError}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center rounded-md bg-blue text-bg-0 font-semibold px-4 py-2.5 hover:opacity-90 disabled:opacity-50 transition"
        >
          {submitting ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-5 text-2xs text-fg-3 text-center leading-relaxed">
        By signing up you agree to the Argus terms of service and privacy policy.
      </p>
    </AuthCard>
  );
}
