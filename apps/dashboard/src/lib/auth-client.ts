/**
 * Client-side auth helpers. These call the Fastify API via the
 * `/be/*` Next.js rewrite, so cookies land on the dashboard origin.
 *
 * Server components that need the current user should call
 * `getMeServerSide()` from `./auth-server.ts` instead — it forwards the
 * inbound cookie header.
 */

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  is_superadmin: boolean;
}

export interface Membership {
  id: string;
  slug: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
}

export interface MeResponse {
  user: AuthedUser;
  orgs: Membership[];
}

export interface AuthError {
  error: string;
  issues?: Array<{ path: (string | number)[]; message: string }>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data: T | AuthError = await res.json().catch(() => ({ error: 'bad_response' } as AuthError));
  if (!res.ok) {
    const err = new Error((data as AuthError).error ?? `HTTP ${res.status}`);
    (err as Error & { status: number; payload: AuthError }).status = res.status;
    (err as Error & { status: number; payload: AuthError }).payload = data as AuthError;
    throw err;
  }
  return data as T;
}

export interface SignupInput {
  email: string;
  password: string;
  name?: string;
  org_name?: string;
}

export function signup(input: SignupInput) {
  return postJson<{ user: AuthedUser; org: { id: string; slug: string } }>(
    '/be/auth/signup',
    input,
  );
}

export function signin(input: { email: string; password: string }) {
  return postJson<{ user: AuthedUser }>('/be/auth/signin', input);
}

export async function signout(): Promise<void> {
  await fetch('/be/auth/signout', { method: 'POST', credentials: 'include' });
}
