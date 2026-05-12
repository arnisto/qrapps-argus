'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Result {
  ok: boolean;
  model?: string;
  error?: string;
}

/**
 * "Test now" for an LLM credential. Mirrors TestNowButton (connector test):
 * a route-handler call (not a server action), prominent in-place feedback,
 * persistent state until next click. Pings the provider with a 1-token
 * completion using the stored API key.
 */
export function TestCredentialButton({ credentialId }: { credentialId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  let label = 'Test key';
  let tone = '';
  if (pending) {
    label = '⟳ Testing…';
    tone = 'pending';
  } else if (result) {
    if (result.ok) {
      label = `✓ Key works${result.model ? ` · ${result.model}` : ''}`;
      tone = 'ok';
    } else {
      label = `✗ ${(result.error ?? 'failed').slice(0, 80)}`;
      tone = 'fail';
    }
  }

  async function run() {
    setPending(true);
    try {
      const res = await fetch(`/api/llm-credentials/${credentialId}/test`, { method: 'POST' });
      const data = (await res.json()) as Result;
      setResult(data);
      if (data.ok) router.refresh();
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'fetch failed' });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void run();
      }}
      className={[
        'ds-btn sm',
        tone === 'ok' ? 'success' : '',
        tone === 'fail' ? 'danger' : '',
        tone === 'pending' ? 'primary' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        minWidth: 110,
        maxWidth: 460,
        textAlign: 'left',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </button>
  );
}
