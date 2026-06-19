'use client';

import { useState, type FormEvent } from 'react';
import { Field } from '@/components/auth/Field';

export function RenameForm({
  slug,
  defaultName,
  defaultModel,
}: {
  slug: string;
  defaultName: string;
  defaultModel: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const body: Record<string, string> = {
      name: String(f.get('name') ?? '').trim(),
      primary_model: String(f.get('primary_model') ?? '').trim(),
    };
    try {
      const res = await fetch(`/be/envs/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      // Hard refresh so the page (server component) re-fetches with the new values.
      window.location.href = `/environments/${slug}?ok=saved`;
    } catch (err) {
      setError((err as Error).message || 'Could not save changes.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Field name="name" label="Display name" defaultValue={defaultName} required />
      <Field
        name="primary_model"
        label="Primary model"
        defaultValue={defaultModel}
        required
      />
      {error ? (
        <div className="sm:col-span-2 text-sm text-rose bg-rose/10 border border-rose/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}
      <div className="sm:col-span-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-blue text-bg-0 font-semibold px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
        >
          {submitting ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
