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
  /** Number of OTHER envs in the same org. When > 0, surface the share checkbox. */
  otherEnvsInOrg,
  orgName,
}: {
  envSlug: string;
  def: ProviderDef;
  existing: ProviderRow | null;
  otherEnvsInOrg: number;
  orgName: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // The "share to siblings" toggle. Default OFF so a buyer's first connect
  // doesn't quietly fan out to envs they didn't intend.
  const [applyToOrg, setApplyToOrg] = useState(false);

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
      apply_to_org: applyToOrg,
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
      const data = (await res.json()) as { applied_to?: number };
      const n = data.applied_to ?? 1;
      setOk(
        existing
          ? `Key rotated${n > 1 ? ` · synced to ${n} envs in ${orgName}` : ''}.`
          : `Connected${n > 1 ? ` · applied to ${n} envs in ${orgName}` : ''}.`,
      );
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

      {otherEnvsInOrg > 0 ? (
        <label className="sm:col-span-2 flex items-start gap-2.5 cursor-pointer text-sm select-none">
          <input
            type="checkbox"
            checked={applyToOrg}
            onChange={(e) => setApplyToOrg(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded-sm border-border accent-accent"
          />
          <span className="flex-1">
            <span className="text-text font-medium">
              Apply this key to my other {otherEnvsInOrg} env{otherEnvsInOrg === 1 ? '' : 's'} in <strong>{orgName}</strong>
            </span>
            <span className="block text-xs text-text-3 mt-0.5 leading-snug">
              Same provider, same key — every env in this org will share it. Rotating later updates them all in one step.
            </span>
          </span>
        </label>
      ) : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent text-white font-semibold px-3.5 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
        >
          {submitting
            ? 'Saving…'
            : existing
              ? applyToOrg
                ? `Rotate across ${otherEnvsInOrg + 1} envs`
                : 'Rotate key'
              : applyToOrg
                ? `Connect to all ${otherEnvsInOrg + 1} envs`
                : `Connect ${def.label}`}
        </button>
      </div>
    </form>
  );
}
