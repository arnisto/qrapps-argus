'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { IconChevronDown } from '@/components/shell/icons';
import type { EnvRow } from '@/lib/envs-server';

/**
 * Inline env picker for top-level engine pages. Renders as a chip in the
 * page header showing "Env · Speedo Express"; opens a dropdown of every
 * env the user can reach so they can switch the page's context without
 * leaving it. Writes ?env=<slug> to the URL — server components re-render
 * with the new context. Hidden when the user has only one env.
 */
export function EnvPicker({ envs, current }: { envs: EnvRow[]; current: EnvRow }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (envs.length <= 1) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-3 font-mono">
        <span className="w-2 h-2 rounded-sm bg-accent" />
        env <span className="text-text">{current.name}</span>
      </span>
    );
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm hover:bg-inset transition"
      >
        <span aria-hidden className="w-2.5 h-2.5 rounded-sm bg-accent" />
        <span className="text-text-3 font-mono text-2xs uppercase tracking-wider">env</span>
        <span className="font-semibold text-text">{current.name}</span>
        <IconChevronDown size={12} className="text-text-3" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 z-30 rounded-xl border border-border bg-surface shadow-card p-1.5 min-w-[220px] animate-fade"
        >
          {envs.map((e) => (
            <Link
              key={e.slug}
              href={`${pathname}?env=${encodeURIComponent(e.slug)}`}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-sm hover:bg-inset transition ${
                e.slug === current.slug ? 'bg-accent-soft text-accent font-semibold' : 'text-text'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-sm bg-accent" />
              <span className="flex-1 truncate">{e.name}</span>
              <span className="font-mono text-2xs text-text-3">{e.slug}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Empty state when the user has zero envs — shown by every engine page. */
export function NoEnvsCard() {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-10 text-center">
      <div className="text-text-2 text-base mb-2">You don't have any environments yet.</div>
      <p className="text-sm text-text-3 mb-4">
        An environment is one isolated tenant — its own connected models, knowledge,
        and API keys. Create one to continue.
      </p>
      <Link
        href="/environments/new"
        className="inline-flex items-center rounded-md bg-accent text-white font-semibold px-3.5 py-2 text-sm hover:opacity-90 transition"
      >
        Create your first environment
      </Link>
    </div>
  );
}
