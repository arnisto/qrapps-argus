/**
 * SSR fetchers for org members + pending invitations. Forwards inbound
 * cookies so Fastify sees the signed-in user.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';

const API_BASE = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

function authHeaders(): HeadersInit {
  return {
    cookie: cookies()
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join('; '),
    'user-agent': headers().get('user-agent') ?? 'argus-dashboard',
  };
}

export type OrgRole = 'owner' | 'admin' | 'member';

export interface MemberRow {
  user_id: string;
  email: string;
  name: string | null;
  role: OrgRole;
  joined_at: string;
  last_login_at: string | null;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: OrgRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export async function listMembersServerSide(orgSlug: string): Promise<{
  members: MemberRow[];
  your_role: OrgRole | null;
} | null> {
  const res = await fetch(
    `${API_BASE}/orgs/${encodeURIComponent(orgSlug)}/members`,
    { headers: authHeaders(), cache: 'no-store' },
  );
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /orgs/${orgSlug}/members → ${res.status}`);
  return (await res.json()) as { members: MemberRow[]; your_role: OrgRole };
}

export async function listInvitationsServerSide(
  orgSlug: string,
): Promise<InvitationRow[]> {
  const res = await fetch(
    `${API_BASE}/orgs/${encodeURIComponent(orgSlug)}/invitations`,
    { headers: authHeaders(), cache: 'no-store' },
  );
  if (res.status === 401 || res.status === 404) return [];
  if (!res.ok) throw new Error(`GET /orgs/${orgSlug}/invitations → ${res.status}`);
  const data = (await res.json()) as { invitations: InvitationRow[] };
  return data.invitations;
}
