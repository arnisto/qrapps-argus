/**
 * Org members + invitations — the SaaS spine.
 *
 *   GET    /orgs/:slug/members                   list users in this org
 *   DELETE /orgs/:slug/members/:userId           remove a member (owner-only)
 *
 *   GET    /orgs/:slug/invitations               list pending invitations
 *   POST   /orgs/:slug/invitations               { email, role } → mints token
 *   DELETE /orgs/:slug/invitations/:id           revoke a pending invitation
 *
 *   GET    /invitations/:token                   public preview (org name, role)
 *   POST   /invitations/:token/accept            authed — adds membership +
 *                                                 marks the invitation accepted
 *
 * Invite-by-link model: we mint an opaque random token, store its sha256
 * in `invitations.token_hash`, and the inviter pastes the link (which carries
 * the plaintext token) into whatever channel they trust. No SMTP wiring
 * required to demo a working invite flow.
 */
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { requireUser } from '../auth/middleware.js';
import { sha256 } from '../auth/api-key.js';
import { canWrite, userRoleIn, type OrgRole } from '../auth/orgs.js';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

async function resolveOrgForUser(
  userId: string,
  slug: string,
): Promise<{ id: string; slug: string; name: string; role: OrgRole } | null> {
  const { rows } = await db().query<{
    id: string;
    slug: string;
    name: string;
    role: OrgRole;
  }>(
    `SELECT o.id, o.slug, o.name, m.role
       FROM organizations o
       JOIN memberships m ON m.org_id = o.id
      WHERE o.slug = $1 AND m.user_id = $2
      LIMIT 1`,
    [slug, userId],
  );
  return rows[0] ?? null;
}

const InviteBody = z.object({
  email: z.string().email().max(254),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
});

export async function registerMemberRoutes(app: FastifyInstance): Promise<void> {
  // ---- GET /orgs/:slug/members --------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/orgs/:slug/members',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const org = await resolveOrgForUser(req.user!.id, req.params.slug);
      if (!org) return reply.code(404).send({ error: 'org_not_found' });
      const { rows } = await db().query<{
        user_id: string;
        email: string;
        name: string | null;
        role: OrgRole;
        joined_at: string;
        last_login_at: string | null;
      }>(
        `SELECT m.user_id, u.email, u.name, m.role,
                m.created_at AS joined_at, u.last_login_at
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.org_id = $1
          ORDER BY m.created_at`,
        [org.id],
      );
      return { org: { id: org.id, slug: org.slug, name: org.name }, your_role: org.role, members: rows };
    },
  );

  // ---- DELETE /orgs/:slug/members/:userId ---------------------------------
  app.delete<{ Params: { slug: string; userId: string } }>(
    '/orgs/:slug/members/:userId',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const org = await resolveOrgForUser(req.user!.id, req.params.slug);
      if (!org) return reply.code(404).send({ error: 'org_not_found' });
      if (org.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
      if (req.params.userId === req.user!.id) {
        return reply.code(400).send({ error: 'cannot_remove_self' });
      }
      // Don't let the last owner get removed by another owner — that'd
      // strand the org. We require there to be at least one OTHER owner
      // remaining after the removal.
      const target = await userRoleIn(req.params.userId, org.id);
      if (target === 'owner') {
        const { rows } = await db().query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM memberships WHERE org_id = $1 AND role = 'owner'`,
          [org.id],
        );
        if (parseInt(rows[0]!.n, 10) <= 1) {
          return reply.code(400).send({ error: 'last_owner' });
        }
      }
      await db().query(
        `DELETE FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [org.id, req.params.userId],
      );
      return reply.code(204).send();
    },
  );

  // ---- GET /orgs/:slug/invitations ----------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/orgs/:slug/invitations',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const org = await resolveOrgForUser(req.user!.id, req.params.slug);
      if (!org) return reply.code(404).send({ error: 'org_not_found' });
      const { rows } = await db().query<{
        id: string;
        email: string;
        role: OrgRole;
        created_at: string;
        expires_at: string;
        accepted_at: string | null;
      }>(
        `SELECT id, email, role, created_at, expires_at, accepted_at
           FROM invitations
          WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC`,
        [org.id],
      );
      return { invitations: rows };
    },
  );

  // ---- POST /orgs/:slug/invitations ---------------------------------------
  // Mints a fresh token; the API returns BOTH the row + the plaintext token
  // so the dashboard can render a shareable link the inviter copies.
  app.post<{ Params: { slug: string } }>(
    '/orgs/:slug/invitations',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const org = await resolveOrgForUser(req.user!.id, req.params.slug);
      if (!org) return reply.code(404).send({ error: 'org_not_found' });
      if (!canWrite(org.role)) return reply.code(403).send({ error: 'forbidden' });
      const parsed = InviteBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
      }
      const { email, role } = parsed.data;
      // Only an owner can hand out owner / admin roles; admins can only
      // invite members. Keeps privilege escalation closed.
      if ((role === 'owner' || role === 'admin') && org.role !== 'owner') {
        return reply.code(403).send({ error: 'forbidden_role' });
      }
      // Bail if the email is already a member.
      const { rowCount: existingMember } = await db().query(
        `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = $1 AND u.email = $2 LIMIT 1`,
        [org.id, email],
      );
      if ((existingMember ?? 0) > 0) {
        return reply.code(409).send({ error: 'already_member' });
      }
      const token = randomBytes(32).toString('base64url');
      const tokenHash = sha256(token);
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      const { rows } = await db().query<{ id: string }>(
        `INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
              VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [org.id, email, role, tokenHash, req.user!.id, expiresAt],
      );
      return reply.code(201).send({
        invitation: {
          id: rows[0]!.id,
          email,
          role,
          expires_at: expiresAt.toISOString(),
          // Shown ONCE — never returned again. Dashboard builds the link.
          token,
        },
      });
    },
  );

  // ---- DELETE /orgs/:slug/invitations/:id ---------------------------------
  app.delete<{ Params: { slug: string; id: string } }>(
    '/orgs/:slug/invitations/:id',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const org = await resolveOrgForUser(req.user!.id, req.params.slug);
      if (!org) return reply.code(404).send({ error: 'org_not_found' });
      if (!canWrite(org.role)) return reply.code(403).send({ error: 'forbidden' });
      await db().query(
        `DELETE FROM invitations WHERE id = $1 AND org_id = $2`,
        [req.params.id, org.id],
      );
      return reply.code(204).send();
    },
  );

  // ---- GET /invitations/:token  (PUBLIC preview) --------------------------
  // Lets the /invite/<token> dashboard page render "Join {org}" before the
  // user signs in. Returns minimal info — org name + role + inviter email —
  // so the link doesn't reveal sensitive details if it leaks.
  app.get<{ Params: { token: string } }>(
    '/invitations/:token',
    async (req, reply) => {
      const hash = sha256(req.params.token);
      const { rows } = await db().query<{
        id: string;
        email: string;
        role: OrgRole;
        org_slug: string;
        org_name: string;
        invited_by_email: string | null;
        expires_at: string;
        accepted_at: string | null;
      }>(
        `SELECT i.id, i.email, i.role, o.slug AS org_slug, o.name AS org_name,
                u.email AS invited_by_email, i.expires_at, i.accepted_at
           FROM invitations i
           JOIN organizations o ON o.id = i.org_id
      LEFT JOIN users u ON u.id = i.invited_by
          WHERE i.token_hash = $1
          LIMIT 1`,
        [hash],
      );
      const inv = rows[0];
      if (!inv) return reply.code(404).send({ error: 'invitation_not_found' });
      if (inv.accepted_at) return reply.code(410).send({ error: 'already_accepted' });
      if (new Date(inv.expires_at) <= new Date()) {
        return reply.code(410).send({ error: 'expired' });
      }
      return {
        invited_email: inv.email,
        role: inv.role,
        org: { slug: inv.org_slug, name: inv.org_name },
        invited_by_email: inv.invited_by_email,
        expires_at: inv.expires_at,
      };
    },
  );

  // ---- POST /invitations/:token/accept (authed) ---------------------------
  // Adds the current user as a member of the invited org. We DO allow the
  // emails to differ (a user signed up with workmail@ but was invited at
  // personal@) — the deciding fact is that they hold the link AND have a
  // valid session. If you need strict-match, gate here.
  app.post<{ Params: { token: string } }>(
    '/invitations/:token/accept',
    { onRequest: [requireUser] },
    async (req, reply) => {
      const hash = sha256(req.params.token);
      const client = await db().connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{
          id: string;
          org_id: string;
          role: OrgRole;
          expires_at: string;
          accepted_at: string | null;
        }>(
          `SELECT id, org_id, role, expires_at, accepted_at
             FROM invitations WHERE token_hash = $1 FOR UPDATE`,
          [hash],
        );
        const inv = rows[0];
        if (!inv) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'invitation_not_found' });
        }
        if (inv.accepted_at || new Date(inv.expires_at) <= new Date()) {
          await client.query('ROLLBACK');
          return reply.code(410).send({ error: 'expired_or_used' });
        }
        await client.query(
          `INSERT INTO memberships (user_id, org_id, role)
                VALUES ($1, $2, $3)
           ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role`,
          [req.user!.id, inv.org_id, inv.role],
        );
        await client.query(
          `UPDATE invitations SET accepted_at = now() WHERE id = $1`,
          [inv.id],
        );
        await client.query('COMMIT');
        const { rows: orgRows } = await db().query<{ slug: string; name: string }>(
          `SELECT slug, name FROM organizations WHERE id = $1`,
          [inv.org_id],
        );
        return { org: orgRows[0]!, role: inv.role };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
