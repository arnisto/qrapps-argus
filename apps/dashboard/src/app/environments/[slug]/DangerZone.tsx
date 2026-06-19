'use client';

import { useState } from 'react';

export function DangerZone({ slug }: { slug: string }) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/be/envs/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.status !== 204) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      window.location.href = '/environments?ok=deleted';
    } catch (err) {
      setError((err as Error).message || 'Could not delete.');
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return (
      <div>
        <p className="text-sm text-fg-2 mb-3">
          Permanently delete this environment and ALL its connected providers,
          API keys, sources, chunks, and request history.
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md bg-rose/15 text-rose border border-rose/40 hover:bg-rose/25 px-4 py-2 text-sm font-semibold transition"
        >
          Delete this environment
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-fg-1 mb-3">
        Type the slug <code className="text-rose">{slug}</code> to confirm. This
        cannot be undone.
      </p>
      <ConfirmBox slug={slug} onConfirmed={doDelete} disabled={submitting} />
      {error ? (
        <div className="text-sm text-rose bg-rose/10 border border-rose/30 rounded-md px-3 py-2 mt-3">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function ConfirmBox({
  slug,
  onConfirmed,
  disabled,
}: {
  slug: string;
  onConfirmed: () => void;
  disabled: boolean;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === slug;
  return (
    <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
      <input
        autoFocus
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={slug}
        className="rounded-md bg-bg-0 border border-line px-3.5 py-2 text-sm focus:border-rose focus:ring-2 focus:ring-rose/30 outline-none w-full sm:w-72"
      />
      <button
        type="button"
        disabled={!matches || disabled}
        onClick={onConfirmed}
        className="rounded-md bg-rose text-bg-0 font-semibold px-4 py-2 text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {disabled ? 'Deleting…' : 'Permanently delete'}
      </button>
    </div>
  );
}
