'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Inline Q&A teach form. Posts to /be/envs/:slug/sources/qa. Q&A counts
 * as a high-authority source on the backend (authority=90 vs file=60) so
 * a freshly-taught answer outranks document-derived ones during retrieval.
 */
export function QaForm({
  envSlug,
  initialQuestion,
  onTaught,
}: {
  envSlug: string;
  /** When present (used by the inline Ask "teach the answer" CTA), pre-fills the question and locks it. */
  initialQuestion?: string;
  /** Called after a successful save so the caller can re-fire its own action (e.g. re-ask the question). */
  onTaught?: (q: string, a: string) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taught, setTaught] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setTaught(null);
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const question = String(f.get('question') ?? '').trim();
    const answer = String(f.get('answer') ?? '').trim();
    if (!question || !answer) {
      setError('Both the question and the answer are required.');
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch(
        `/be/envs/${encodeURIComponent(envSlug)}/sources/qa`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question, answer }),
        },
      );
      const data = (await res.json().catch(() => null)) as
        | { source?: { chunks: number }; error?: string; message?: string }
        | null;
      if (!res.ok || !data?.source) {
        throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      }
      setTaught(question.slice(0, 80));
      if (!initialQuestion) {
        (e.target as HTMLFormElement).reset();
      }
      router.refresh();
      onTaught?.(question, answer);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const labelCls =
    'block text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1';
  const inputCls =
    'block w-full rounded-md bg-surface-2 border border-border px-3 py-2 text-sm text-text outline-none placeholder:text-text-3 focus:border-accent focus:shadow-focus transition';

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <label className="block">
        <span className={labelCls}>Question</span>
        <input
          name="question"
          defaultValue={initialQuestion}
          readOnly={!!initialQuestion}
          placeholder='e.g. "Do you offer same-day delivery?"'
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className={labelCls}>Answer</span>
        <textarea
          name="answer"
          rows={4}
          placeholder="The grounded answer Argus should give. Plain language is best."
          className={`${inputCls} resize-y min-h-[88px]`}
        />
      </label>
      {error ? (
        <div className="text-sm text-red bg-red-soft border border-red/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}
      {taught ? (
        <div className="text-sm text-green bg-green-soft border border-green/30 rounded-md px-3 py-2">
          Taught: <strong>{taught}</strong>
          {taught.length === 80 ? '…' : ''} — Argus will use it next time you ask.
        </div>
      ) : null}
      <div className="pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent text-white font-semibold px-3.5 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
        >
          {submitting ? 'Teaching…' : 'Teach Argus'}
        </button>
      </div>
    </form>
  );
}
