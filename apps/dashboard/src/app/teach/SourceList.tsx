'use client';

import { useRouter } from 'next/navigation';
import type { SourceRow } from '@/lib/providers-server';

function humanBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function SourceList({
  envSlug,
  sources,
}: {
  envSlug: string;
  sources: SourceRow[];
}) {
  const router = useRouter();
  if (sources.length === 0) {
    return (
      <div className="text-sm text-text-3">
        Nothing taught yet — drop a file above to see Argus ground on it.
      </div>
    );
  }
  async function onDelete(id: string, title: string) {
    if (!confirm(`Delete "${title}" and all its chunks?`)) return;
    await fetch(
      `/be/envs/${encodeURIComponent(envSlug)}/sources/${id}`,
      { method: 'DELETE', credentials: 'include' },
    );
    router.refresh();
  }
  return (
    <ul className="divide-y divide-border">
      {sources.map((s) => (
        <li key={s.id} className="py-3 flex items-start gap-3">
          <span
            className={`flex-none font-mono text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${
              s.kind === 'file'
                ? 'text-accent bg-accent-soft'
                : 'text-amber bg-amber-soft'
            }`}
          >
            {s.kind === 'file' ? 'FILE' : 'Q&A'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text truncate">{s.title}</div>
            <div className="font-mono text-2xs text-text-3 mt-0.5">
              {s.chunks} chunks · {humanBytes(s.bytes)} ·{' '}
              {s.created_at.slice(0, 16).replace('T', ' ')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDelete(s.id, s.title)}
            className="flex-none text-2xs font-semibold rounded-md text-red border border-red/40 bg-red-soft px-3 py-1 hover:bg-red/15 transition"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
