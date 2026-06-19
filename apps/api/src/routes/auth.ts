/**
 * Auth routes — sign up, sign in, sign out, current user.
 *
 * Sign-up auto-provisions a personal organization for the user (slug derived
 * from email local-part) so the welcome flow can drop them straight into
 * "your first environment." Multi-org joins happen via /invitations later.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  destroySession,
} from '../auth/sessions.js';
import { requireUser } from '../auth/middleware.js';

const SignupBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120).optional(),
  org_name: z.string().min(1).max(120).optional(),
});

const SigninBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

function slugifyEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  return (
    local
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'user'
  );
}

async function uniqueOrgSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rowCount } = await db().query(
      `SELECT 1 FROM organizations WHERE slug = $1 LIMIT 1`,
      [candidate],
    );
    if (rowCount === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ----- POST /auth/signup ----------------------------------------------------
  app.post('/auth/signup', async (req, reply) => {
    const parsed = SignupBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const { email, password, name, org_name } = parsed.data;

    const existing = await db().query(
      `SELECT 1 FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    if ((existing.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: 'email_already_registered' });
    }

    const pwHash = await hashPassword(password);

    // Transaction: create user + personal org + owner membership atomically.
    const client = await db().connect();
    let userId: string;
    let orgId: string;
    let orgSlug: string;
    try {
      await client.query('BEGIN');

      const u = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3) RETURNING id`,
        [email, pwHash, name ?? null],
      );
      userId = u.rows[0]!.id;

      orgSlug = await uniqueOrgSlug(slugifyEmail(email));
      const o = await client.query<{ id: string }>(
        `INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id`,
        [orgSlug, org_name ?? `${name ?? email.split('@')[0]}'s workspace`],
      );
      orgId = o.rows[0]!.id;

      await client.query(
        `INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')`,
        [userId, orgId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const { token, expiresAt } = await createSession(userId, {
      userAgent: req.headers['user-agent'],
      ipAddr: req.ip,
    });

    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: expiresAt,
    });

    return reply.code(201).send({
      user: { id: userId, email, name: name ?? null, is_superadmin: false },
      org: { id: orgId, slug: orgSlug },
    });
  });

  // ----- POST /auth/signin ----------------------------------------------------
  app.post('/auth/signin', async (req, reply) => {
    const parsed = SigninBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const { email, password } = parsed.data;

    const { rows } = await db().query<{
      id: string;
      email: string;
      name: string | null;
      password_hash: string;
      is_superadmin: boolean;
    }>(
      `SELECT id, email, name, password_hash, is_superadmin FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    const user = rows[0];
    // Constant-ish-time: always run bcrypt.compare even on missing user so
    // the timing doesn't reveal whether the email is registered.
    const fakeHash = '$2b$12$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopq';
    const ok = await verifyPassword(password, user?.password_hash ?? fakeHash);
    if (!user || !ok) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    await db().query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ipAddr: req.ip,
    });

    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: expiresAt,
    });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        is_superadmin: user.is_superadmin,
      },
    });
  });

  // ----- POST /auth/signout ---------------------------------------------------
  app.post('/auth/signout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  // ----- GET /auth/me ---------------------------------------------------------
  app.get(
    '/auth/me',
    { onRequest: [requireUser] },
    async (req, _reply) => {
      const user = req.user!;
      const { rows: orgs } = await db().query<{
        id: string;
        slug: string;
        name: string;
        role: string;
      }>(
        `SELECT o.id, o.slug, o.name, m.role
           FROM organizations o
           JOIN memberships m ON m.org_id = o.id
          WHERE m.user_id = $1
          ORDER BY o.created_at`,
        [user.id],
      );
      return { user, orgs };
    },
  );
}

// `SESSION_TTL_MS` is also re-exported in case a consumer of /auth/me wants
// to render "session expires in N days" client-side without importing from
// the sessions module directly.
export { SESSION_TTL_MS };
