'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import type { Membership } from '@/lib/auth-client';
import { signout } from '@/lib/auth-client';
import { IconChevronDown, IconLock, IconPlus } from './icons';

// ---- Initials Avatar ------------------------------------------------------
export function InitialsAvatar({ name, email, size = 30 }: { name?: string | null; email: string; size?: number }) {
  const initials =
    (name ?? email)
      .split(/[\s.@]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'U';
  return (
    <button
      type="button"
      onClick={async () => {
        await signout();
        window.location.href = '/signin';
      }}
      style={{ width: size, height: size }}
      className="rounded-full bg-accent text-white text-xs font-semibold flex items-center justify-center hover:opacity-90 transition"
      title={`${name ?? email} — click to sign out`}
    >
      {initials}
    </button>
  );
}

// ---- Org / "Business" switcher (top bar) ----------------------------------
// Hardcoded color swatches — once we add `color` columns on the org table
// we'll source from there. For now, deterministic-by-slug palette.
const ORG_COLORS = ['#2A6FDB', '#c2742e', '#6b5bd6', '#1f8a5b', '#a9701a', '#bb3a2c'];
function colorFor(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i += 1) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return ORG_COLORS[h % ORG_COLORS.length] ?? ORG_COLORS[0]!;
}

export function OrgSwitcher({ orgs, activeSlug }: { orgs: Membership[]; activeSlug: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const active = orgs.find((o) => o.slug === activeSlug) ?? orgs[0];
  if (!active) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm hover:bg-inset transition"
      >
        <span
          aria-hidden
          style={{ background: colorFor(active.slug) }}
          className="block w-2.5 h-2.5 rounded-sm"
        />
        <span className="font-semibold text-text">{active.name}</span>
        <span className="font-mono text-2xs text-text-3 uppercase tracking-wider">
          {active.role}
        </span>
        <IconChevronDown size={12} className="text-text-3" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 mt-1.5 w-[260px] rounded-xl border border-border bg-surface shadow-card p-1.5 z-30 animate-fade"
        >
          <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-text-3">
            Businesses
          </div>
          {orgs.map((o) => (
            <Link
              key={o.id}
              href="/dashboard"
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-sm hover:bg-inset transition ${
                o.slug === active.slug ? 'bg-accent-soft text-accent' : 'text-text'
              }`}
            >
              <span style={{ background: colorFor(o.slug) }} className="block w-2.5 h-2.5 rounded-sm" />
              <span className="flex-1 font-medium">{o.name}</span>
              <span className="font-mono text-2xs text-text-3 uppercase tracking-wider">
                {o.role}
              </span>
            </Link>
          ))}
          <div className="my-1 h-px bg-border" />
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-text-3 cursor-default">
            <IconPlus size={14} className="opacity-40" />
            Multi-org coming soon
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---- Env switcher (sidebar top) -------------------------------------------
export interface EnvOption {
  slug: string;
  name: string;
}

export function EnvSwitcher({
  envs,
  activeSlug,
}: {
  envs: EnvOption[];
  activeSlug?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const allLabel = 'All environments';
  const active = envs.find((e) => e.slug === activeSlug);
  const label = active?.name ?? allLabel;
  const color = active ? colorFor(active.slug) : 'var(--text-3)';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-left hover:bg-inset transition"
      >
        <span aria-hidden style={{ background: color }} className="block w-2.5 h-2.5 rounded-sm flex-none" />
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-text-3">
            Environment
          </span>
          <span className="text-sm font-semibold text-text truncate">{label}</span>
        </span>
        <IconChevronDown size={14} className="text-text-3 flex-none" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 right-0 mt-1.5 rounded-xl border border-border bg-surface shadow-card p-1.5 z-30 animate-fade"
        >
          <button
            type="button"
            onClick={() => {
              router.push('/environments');
              setOpen(false);
            }}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm hover:bg-inset transition ${
              !active ? 'bg-accent-soft text-accent' : 'text-text'
            }`}
          >
            <span style={{ background: 'var(--text-3)' }} className="block w-2.5 h-2.5 rounded-sm" />
            {allLabel}
          </button>
          <div className="my-1 h-px bg-border" />
          {envs.map((e) => (
            <button
              key={e.slug}
              type="button"
              onClick={() => {
                router.push(`/environments/${e.slug}`);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm hover:bg-inset transition ${
                e.slug === active?.slug ? 'bg-accent-soft text-accent' : 'text-text'
              }`}
            >
              <span style={{ background: colorFor(e.slug) }} className="block w-2.5 h-2.5 rounded-sm" />
              <span className="truncate">{e.name}</span>
            </button>
          ))}
          {envs.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-text-3">
              No environments yet.
            </div>
          ) : null}
          <div className="my-1 h-px bg-border" />
          <Link
            href="/environments/new"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-accent hover:bg-accent-soft transition"
          >
            <IconPlus size={14} />
            New environment
          </Link>
        </div>
      ) : null}
    </div>
  );
}

// ---- Guardrails card (sidebar bottom) -------------------------------------
export function GuardrailsCard() {
  return (
    <div className="rounded-lg border border-border bg-inset p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <IconLock size={14} className="text-green" />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-green">
          Guardrails active
        </span>
      </div>
      <p className="text-xs text-text-2 leading-snug">
        Nothing sends without your approval. Drafts are grounded-only. DB access is
        read-only.
      </p>
    </div>
  );
}

// ---- "self-hosted" badge + LiteLLM pill -----------------------------------
export function SelfHostedBadge() {
  return (
    <span className="font-mono text-2xs font-medium text-text-2 bg-inset border border-border px-2 py-0.5 rounded-sm">
      self-hosted
    </span>
  );
}

export function GatewayPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-2xs font-medium text-accent bg-accent-soft px-2 py-0.5 rounded-sm inline-flex items-center gap-1.5">
      <span aria-hidden className="block w-1.5 h-1.5 rounded-full bg-green" />
      {children}
    </span>
  );
}
