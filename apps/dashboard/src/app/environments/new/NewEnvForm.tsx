'use client';

import { useState, type FormEvent } from 'react';
import { Field } from '@/components/auth/Field';

export function NewEnvForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const body = {
      name: String(f.get('name') ?? '').trim(),
      slug: (f.get('slug') as string).trim() || undefined,
      primary_model: String(f.get('primary_model') ?? 'gemini-2.5-flash').trim(),
    };
    try {
      const res = await fetch('/be/envs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { env: { slug: string } };
      window.location.href = `/environments/${data.env.slug}?ok=created`;
    } catch (err) {
      setError((err as Error).message || 'Could not create environment.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field
        name="name"
        label="Name"
        autoFocus
        required
        placeholder="e.g. Acme Logistics"
      />
      <Field
        name="slug"
        label="Slug (optional)"
        placeholder="auto-derived from name"
        hint="Lowercase letters, digits, dashes. Permanent — used in the URL."
      />
      <Field
        name="primary_model"
        label="Primary model"
        required
        defaultValue="gemini-2.5-flash"
        hint="The default model for new chat traffic on this env."
      />
      {error ? (
        <div className="text-sm text-rose bg-rose/10 border border-rose/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-blue text-bg-0 font-semibold px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
        >
          {submitting ? 'Creating…' : 'Create environment'}
        </button>
        <a
          href="/environments"
          className="text-fg-2 text-sm hover:text-fg-0 underline-offset-4 hover:underline"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
