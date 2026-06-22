'use client';

import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';

export function UploadDropzone({ envSlug }: { envSlug: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ name: string; chunks: number; tokens: number } | null>(null);

  async function upload(file: File) {
    setError(null);
    setLast(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/be/envs/${encodeURIComponent(envSlug)}/sources`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as
        | { source?: { chunks: number; tokens: number }; error?: string; message?: string }
        | null;
      if (!res.ok || !data?.source) {
        throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      }
      setLast({ name: file.name, chunks: data.source.chunks, tokens: data.source.tokens });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setHover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void upload(f);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void upload(f);
  }

  return (
    <>
      <label
        htmlFor="teach-file-input"
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        className={[
          'flex flex-col items-center justify-center gap-2',
          'rounded-xl border-2 border-dashed p-10 cursor-pointer transition',
          hover
            ? 'border-accent bg-accent-soft'
            : 'border-border-2 bg-bg hover:bg-inset',
        ].join(' ')}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 20 20"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10 12V4" />
          <path d="M6.5 7.5 10 4l3.5 3.5" />
          <path d="M3 14v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2" />
        </svg>
        <div className="text-sm text-text font-semibold">
          {busy ? 'Uploading + embedding…' : 'Drop a file or click to choose'}
        </div>
        <div className="text-2xs text-text-3">
          Chunked, embedded with gemini-embedding-001 (768d), indexed into the
          knowledge core for this env.
        </div>
        <input
          ref={inputRef}
          id="teach-file-input"
          type="file"
          accept=".md,.markdown,.txt,.html,.htm,text/plain,text/markdown,text/html"
          className="sr-only"
          onChange={onChange}
        />
      </label>
      {error ? (
        <div className="mt-3 text-sm text-red bg-red-soft border border-red/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}
      {last ? (
        <div className="mt-3 text-sm text-green bg-green-soft border border-green/30 rounded-md px-3 py-2">
          <strong>{last.name}</strong> — {last.chunks} chunk{last.chunks === 1 ? '' : 's'}{' '}
          indexed (~{last.tokens} tokens).
        </div>
      ) : null}
    </>
  );
}
