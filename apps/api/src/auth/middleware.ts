/**
 * Auth plumbing for Fastify.
 *
 * `attachUser` is an `onRequest` hook that — if a session cookie is present
 * and valid — populates `req.user` and `req.session`. It NEVER fails the
 * request; it just leaves req.user undefined when there's no session.
 *
 * `requireUser` is the gate to attach to routes that must be authenticated.
 *
 * The legacy bearer-token gate (for /v1/events from worker / connectors) is
 * gone — this server is now session-cookie based. Service-to-service calls
 * will use scoped API keys (the `api_keys` table), surfaced as their own
 * /v1/* endpoints and checked separately.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db.js';
import { SESSION_COOKIE, lookupSession, touchSession } from './sessions.js';

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  is_superadmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
    session?: { id: string };
  }
}

export async function attachUser(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return;
  const session = await lookupSession(token);
  if (!session) return;
  const { rows } = await db().query<AuthedUser>(
    `SELECT id, email, name, is_superadmin FROM users WHERE id = $1 LIMIT 1`,
    [session.user_id],
  );
  const user = rows[0];
  if (!user) return;
  req.user = user;
  req.session = { id: session.id };
  // Slide the expiry — but don't await, so it doesn't slow the request.
  void touchSession(session.id);
}

export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.user) {
    reply.code(401).send({ error: 'unauthenticated' });
  }
}
