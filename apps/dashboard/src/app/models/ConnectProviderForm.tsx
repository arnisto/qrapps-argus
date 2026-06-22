'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Field } from '@/components/auth/Field';
import type { ProviderRow } from '@/lib/providers-server';

export interface ProviderDef {
  /** Wire name — matches the `providers.name` column. */
  id: 'gemini' | 'groq';
  /** UI label. */
  label: string;
  /** API key placeholder shown in the input. */
  placeholder: string;
  /** Sensible default model id. */
  default_model: string;
  /** One-line help below the key input. */
  keyHelp: string;
}

export function ConnectProviderForm({
  envSlug,
  def,
  existing,
}: {
  envSlug: string;
  def: ProviderDef;
  existing: ProviderRow | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const body = {
      name: def.id,
      api_key: String(f.get('api_key') ?? '').trim(),
      default_model: String(f.get('default_model') ?? def.default_model).trim(),
    };
    try {
      const res = await fetch(`/be/envs/${encodeURIComponent(envSlug)}/providers`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setOk(existing ? 'Key rotated.' : 'Connected.');
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_220px]" noValidate>
      <Field
        name="api_key"
        type="password"
        autoComplete="off"
        label={existing ? 'Rotate API key' : 'API key'}
        placeholder={def.placeholder}
        required
        hint={def.keyHelp}
      />
      <Field
        name="default_model"
        label="Default model"
        defaultValue={existing?.default_model ?? def.default_model}
        required
      />
      {error ? (
        <div className="sm:col-span-2 text-sm text-red bg-red-soft border border-red/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}
      {ok ? (
        <div className="sm:col-span-2 text-sm text-green bg-green-soft border border-green/30 rounded-md px-3 py-2">
          {ok}
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent text-white font-semibold px-3.5 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
        >
          {submitting ? 'Saving…' : existing ? 'Rotate key' : `Connect ${def.label}`}
        </button>
      </div>
    </form>
  );
}
