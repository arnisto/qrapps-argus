'use client';

import { useRouter } from 'next/navigation';
import type { InvitationRow } from '@/lib/members-server';

export function InvitationsTable({
  orgSlug,
  invitations,
  canRevoke,
}: {
  orgSlug: string;
  invitations: InvitationRow[];
  canRevoke: boolean;
}) {
  const router = useRouter();
  async function onRevoke(id: string, email: string) {
    if (!confirm(`Revoke the invitation to ${email}?`)) return;
    await fetch(
      `/be/orgs/${encodeURIComponent(orgSlug)}/invitations/${id}`,
      { method: 'DELETE', credentials: 'include' },
    );
    router.refresh();
  }

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm min-w-[480px]">
        <thead className="text-2xs uppercase tracking-wider text-text-3 font-mono">
          <tr>
            <th className="text-left py-2 px-1">Email</th>
            <th className="text-left py-2 px-1">Role</th>
            <th className="text-left py-2 px-1">Expires</th>
            <th className="py-2 px-1"></th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((i) => (
            <tr key={i.id} className="border-t border-border">
              <td className="py-2 px-1 text-text">{i.email}</td>
              <td className="py-2 px-1 font-mono text-2xs text-text-2 uppercase tracking-wider">
                {i.role}
              </td>
              <td className="py-2 px-1 font-mono text-2xs text-text-3 whitespace-nowrap">
                {i.expires_at.slice(0, 10)}
              </td>
              <td className="py-2 px-1 text-right">
                {canRevoke ? (
                  <button
                    type="button"
                    onClick={() => onRevoke(i.id, i.email)}
                    className="text-2xs font-semibold rounded-md text-red border border-red/40 bg-red-soft px-2.5 py-1 hover:bg-red/15 transition"
                  >
                    Revoke
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
