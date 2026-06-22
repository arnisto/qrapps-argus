'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiKeyRow } from '@/lib/providers-server';

interface MintedKey {
  id: string;
  name: string;
  prefix: string;
  key: string;
}

export function KeysSection({
  envSlug,
  keys,
}: {
  envSlug: string;
  keys: ApiKeyRow[];
}) {
  const router = useRouter();
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<MintedKey | null>(null);
  const [copied, setCopied] = useState(false);

  async function onMint(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setRevealed(null);
    setCopied(false);
    setMinting(true);
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (!name) {
      setError('Give the key a name first.');
      setMinting(false);
      return;
    }
    try {
      const res = await fetch(`/be/envs/${encodeURIComponent(envSlug)}/api-keys`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { api_key: MintedKey };
      setRevealed(data.api_key);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMinting(false);
    }
  }

  async function onCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // browsers without clipboard permission — user can still triple-click
    }
  }

  async function onRevoke(id: string, name: string) {
    if (!confirm(`Revoke "${name}"? Any client using it will start getting 401.`)) {
      return;
    }
    await fetch(
      `/be/envs/${encodeURIComponent(envSlug)}/api-keys/${id}`,
      { method: 'DELETE', credentials: 'include' },
    );
    router.refresh();
  }

  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface shadow-card p-5 sm:p-6">
      <h2 className="text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1.5">
        API keys ({keys.length})
      </h2>
      <p className="text-sm text-text-2 mb-4">
        Mint a key, put it in your client's <code className="font-mono">Authorization</code> header.
        We store the SHA-256 hash; the plaintext is shown <strong>once</strong>.
      </p>

      <form onSubmit={onMint} className="flex flex-wrap items-end gap-2 mb-4">
        <label className="flex-1 min-w-[200px]">
          <span className="block text-2xs font-semibold uppercase tracking-wider text-text-2 mb-1">
            New key name
          </span>
          <input
            name="name"
            placeholder='e.g. "prod-server-east"'
            className="block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text outline-none focus:border-accent focus:shadow-focus transition"
          />
        </label>
        <button
          type="submit"
          disabled={minting}
          className="rounded-md bg-accent text-white font-semibold px-3.5 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
        >
          {minting ? 'Minting…' : 'Mint key'}
        </button>
      </form>

      {error ? (
        <div className="mb-4 text-sm text-red bg-red-soft border border-red/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}

      {revealed ? (
        <div className="mb-4 rounded-md border border-amber bg-amber-soft p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-amber">
              ⚠ Shown once — copy now
            </span>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="text-2xs text-amber hover:underline"
            >
              dismiss
            </button>
          </div>
          <code className="block font-mono text-sm bg-surface border border-border rounded-md px-3 py-2 break-all">
            {revealed.key}
          </code>
          <button
            type="button"
            onClick={() => onCopy(revealed.key)}
            className="mt-2 rounded-md bg-accent text-white text-2xs font-semibold px-3 py-1.5 hover:opacity-90 transition"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <div className="text-sm text-text-3">No keys yet — mint one to call /v1/chat.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-2xs uppercase tracking-wider text-text-3 font-mono">
            <tr>
              <th className="text-left py-2">Name</th>
              <th className="text-left py-2">Prefix</th>
              <th className="text-right py-2">Rate / min</th>
              <th className="text-left py-2">Last used</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-border">
                <td className="py-2 font-semibold text-text">{k.name}</td>
                <td className="py-2 font-mono text-2xs text-text-2">{k.key_prefix}</td>
                <td className="py-2 text-right text-text">{k.rate_per_min}</td>
                <td className="py-2 font-mono text-2xs text-text-3">
                  {k.last_used_at ? k.last_used_at.slice(0, 16).replace('T', ' ') : '—'}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onRevoke(k.id, k.name)}
                    className="text-2xs font-semibold rounded-md text-red border border-red/40 bg-red-soft px-2.5 py-1 hover:bg-red/15 transition"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
