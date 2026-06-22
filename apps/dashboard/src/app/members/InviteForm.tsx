'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { OrgRole } from '@/lib/members-server';

interface RevealedInvite {
  token: string;
  email: string;
  role: OrgRole;
  expires_at: string;
}

export function InviteForm({
  orgSlug,
  yourRole,
}: {
  orgSlug: string;
  yourRole: OrgRole | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const canMakeAdminOrOwner = yourRole === 'owner';
  const canInvite = yourRole === 'owner' || yourRole === 'admin';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setRevealed(null);
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? '').trim();
    const role = (String(f.get('role') ?? 'member') as OrgRole) || 'member';
    try {
      const res = await fetch(
        `/be/orgs/${encodeURIComponent(orgSlug)}/invitations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, role }),
        },
      );
      const data = (await res.json().catch(() => null)) as
        | { invitation?: RevealedInvite; error?: string }
        | null;
      if (!res.ok || !data?.invitation) {
        const code = data?.error ?? `HTTP ${res.status}`;
        throw new Error(
          code === 'already_member'
            ? 'That email is already a member of this org.'
            : code === 'forbidden_role'
              ? 'Only owners can invite admins or other owners.'
              : code,
        );
      }
      setRevealed(data.invitation);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function onCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard denied — triple-click the link below
    }
  }

  if (!canInvite) {
    return (
      <div className="text-sm text-text-3">
        Only owners and admins can invite new members. Ask one of yours to send
        the invite.
      </div>
    );
  }

  const inviteLink = revealed
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/invite/${revealed.token}`
    : '';

  const labelCls =
    'block text-2xs font-semibold uppercase tracking-wider text-text-3 mb-1';
  const inputCls =
    'block w-full rounded-md bg-surface-2 border border-border px-3 py-2 text-sm text-text outline-none placeholder:text-text-3 focus:border-accent focus:shadow-focus transition';

  return (
    <>
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] items-end" noValidate>
        <label className="block">
          <span className={labelCls}>Email</span>
          <input
            name="email"
            type="email"
            placeholder="teammate@company.com"
            required
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={labelCls}>Role</span>
          <select name="role" defaultValue="member" className={inputCls}>
            <option value="member">Member</option>
            <option value="admin" disabled={!canMakeAdminOrOwner}>
              Admin{canMakeAdminOrOwner ? '' : ' (owner only)'}
            </option>
            <option value="owner" disabled={!canMakeAdminOrOwner}>
              Owner{canMakeAdminOrOwner ? '' : ' (owner only)'}
            </option>
          </select>
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent text-white font-semibold px-3.5 py-2 text-sm hover:opacity-90 disabled:opacity-50 transition"
        >
          {submitting ? 'Sending…' : 'Send invite'}
        </button>
      </form>

      {error ? (
        <div className="mt-3 text-sm text-red bg-red-soft border border-red/30 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}

      {revealed ? (
        <div className="mt-4 rounded-md border border-amber bg-amber-soft p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-amber">
              ⚠ Copy this link — shown once
            </span>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="text-2xs text-amber hover:underline"
            >
              dismiss
            </button>
          </div>
          <div className="text-xs text-text-2 mb-2">
            Send to <strong>{revealed.email}</strong> as <strong>{revealed.role}</strong>.
            Valid until {revealed.expires_at.slice(0, 10)}.
          </div>
          <code className="block font-mono text-xs bg-surface border border-border rounded-md px-3 py-2 break-all">
            {inviteLink}
          </code>
          <button
            type="button"
            onClick={() => onCopy(inviteLink)}
            className="mt-2 rounded-md bg-accent text-white text-2xs font-semibold px-3 py-1.5 hover:opacity-90 transition"
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
      ) : null}
    </>
  );
}
