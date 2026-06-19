/**
 * Org-membership helpers.
 *
 * Every authed route that touches per-env data needs to answer one of:
 *   · "which orgs is this user in?" (for listing)
 *   · "is this user allowed to see/mutate this env?" (for detail / writes)
 *
 * Roles: owner > admin > member.
 *   · owner   — everything, including deleting the org itself
 *   · admin   — CRUD envs, manage members
 *   · member  — read envs, use them, no mutation
 */
import { db } from '../db.js';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface UserMembership {
  org_id: string;
  role: OrgRole;
}

export async function listUserOrgs(userId: string): Promise<UserMembership[]> {
  const { rows } = await db().query<UserMembership>(
    `SELECT org_id, role FROM memberships WHERE user_id = $1`,
    [userId],
  );
  return rows;
}

export async function userOrgIds(userId: string): Promise<string[]> {
  const orgs = await listUserOrgs(userId);
  return orgs.map((m) => m.org_id);
}

/**
 * Return the user's role in the given org, or null if they're not a member.
 * Use to gate mutating endpoints: `role === null` → 404 (so we don't leak
 * existence); `role !== 'owner' && role !== 'admin'` → 403.
 */
export async function userRoleIn(
  userId: string,
  orgId: string,
): Promise<OrgRole | null> {
  const { rows } = await db().query<{ role: OrgRole }>(
    `SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2 LIMIT 1`,
    [userId, orgId],
  );
  return rows[0]?.role ?? null;
}

export function canWrite(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin';
}
