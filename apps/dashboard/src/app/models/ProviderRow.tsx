'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProviderRow as ProviderRowType } from '@/lib/providers-server';

export function ProviderRow({
  envSlug,
  provider,
}: {
  envSlug: string;
  provider: ProviderRowType;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function onTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(
        `/be/envs/${encodeURIComponent(envSlug)}/providers/${provider.id}/test`,
        { method: 'POST', credentials: 'include' },
      );
      const data = (await res.json()) as {
        ok: boolean;
        text?: string;
        error?: string;
        latency_ms?: number;
      };
      setResult({
        ok: !!data.ok,
        text: data.ok
          ? `${data.text} · ${data.latency_ms}ms`
          : data.error ?? 'failed',
      });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Remove ${provider.name}? /v1/chat will stop working for this env.`)) {
      return;
    }
    await fetch(
      `/be/envs/${encodeURIComponent(envSlug)}/providers/${provider.id}`,
      { method: 'DELETE', credentials: 'include' },
    );
    router.refresh();
  }

  return (
    <li className="py-3 flex items-center gap-3 flex-wrap">
      <div className="w-8 h-8 rounded-md bg-inset border border-border flex items-center justify-center font-mono text-2xs font-bold text-text-2 uppercase">
        {provider.name.slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text">{provider.name}</div>
        <div className="font-mono text-2xs text-text-3">
          {provider.default_model}
          {provider.base_url ? ` · ${provider.base_url}` : ''}
        </div>
      </div>
      {provider.has_key ? (
        <span className="inline-flex items-center gap-1.5 font-mono text-2xs font-semibold text-green bg-green-soft px-2 py-0.5 rounded-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-green" />
          key on file
        </span>
      ) : (
        <span className="font-mono text-2xs font-semibold text-amber bg-amber-soft px-2 py-0.5 rounded-sm">
          no key
        </span>
      )}
      <button
        type="button"
        onClick={onTest}
        disabled={testing}
        className="text-2xs font-semibold rounded-md border border-border bg-surface text-text-2 px-3 py-1 hover:text-text hover:bg-inset disabled:opacity-50 transition"
      >
        {testing ? 'Testing…' : 'Test'}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="text-2xs font-semibold rounded-md text-red border border-red/40 bg-red-soft px-3 py-1 hover:bg-red/15 transition"
      >
        Remove
      </button>
      {result ? (
        <div
          className={`basis-full text-2xs font-mono ${
            result.ok ? 'text-green' : 'text-red'
          }`}
        >
          → {result.text}
        </div>
      ) : null}
    </li>
  );
}
