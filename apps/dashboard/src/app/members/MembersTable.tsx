'use client';

import { useRouter } from 'next/navigation';
import type { MemberRow, OrgRole } from '@/lib/members-server';

const ROLE_TONE: Record<OrgRole, string> = {
  owner: 'text-accent bg-accent-soft',
  admin: 'text-green bg-green-soft',
  member: 'text-text-2 bg-inset',
};

export function MembersTable({
  orgSlug,
  members,
  yourRole,
  yourUserId,
}: {
  orgSlug: string;
  members: MemberRow[];
  yourRole: OrgRole | null;
  yourUserId: string;
}) {
  const router = useRouter();
  const canRemove = yourRole === 'owner';

  async function onRemove(userId: string, email: string) {
    if (
      !confirm(
        `Remove ${email} from the org? Their access to envs, models, and chat in this org ends immediately.`,
      )
    ) {
      return;
    }
    const res = await fetch(
      `/be/orgs/${encodeURIComponent(orgSlug)}/members/${userId}`,
      { method: 'DELETE', credentials: 'include' },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      const code = data?.error ?? `HTTP ${res.status}`;
      alert(
        code === 'last_owner'
          ? "Can't remove the only owner — promote someone first."
          : code === 'cannot_remove_self'
            ? "Use account settings to leave the org yourself."
            : code,
      );
      return;
    }
    router.refresh();
  }

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm min-w-[520px]">
        <thead className="text-2xs uppercase tracking-wider text-text-3 font-mono">
          <tr>
            <th className="text-left py-2 px-1">Name</th>
            <th className="text-left py-2 px-1">Email</th>
            <th className="text-left py-2 px-1">Role</th>
            <th className="text-left py-2 px-1">Joined</th>
            <th className="py-2 px-1"></th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.user_id} className="border-t border-border">
              <td className="py-2 px-1 font-semibold text-text">
                {m.name ?? <span className="text-text-3 font-normal">—</span>}
                {m.user_id === yourUserId ? (
                  <span className="ml-2 font-mono text-2xs text-text-3">(you)</span>
                ) : null}
              </td>
              <td className="py-2 px-1 text-text-2">{m.email}</td>
              <td className="py-2 px-1">
                <span
                  className={`inline-flex items-center font-mono text-2xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sm ${ROLE_TONE[m.role]}`}
                >
                  {m.role}
                </span>
              </td>
              <td className="py-2 px-1 font-mono text-2xs text-text-3 whitespace-nowrap">
                {m.joined_at.slice(0, 10)}
              </td>
              <td className="py-2 px-1 text-right">
                {canRemove && m.user_id !== yourUserId ? (
                  <button
                    type="button"
                    onClick={() => onRemove(m.user_id, m.email)}
                    className="text-2xs font-semibold rounded-md text-red border border-red/40 bg-red-soft px-2.5 py-1 hover:bg-red/15 transition"
                  >
                    Remove
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
