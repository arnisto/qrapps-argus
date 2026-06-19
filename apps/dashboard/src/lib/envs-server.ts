/**
 * Server-side fetchers for the envs surface. Forwards inbound cookies so
 * Fastify's session gate sees the current user.
 *
 * Wire types intentionally mirror the Fastify shapes 1:1 — when those
 * change, this file is the canonical place to update.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';

const API_BASE = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

export interface EnvRow {
  id: string;
  org_id: string;
  org_slug: string;
  org_name: string;
  slug: string;
  name: string;
  primary_model: string;
  created_at: string;
  providers: number;
  sources: number;
  chunks: number;
  api_keys: number;
  requests: number;
  cost_usd: string;
  last_request_at: string | null;
}

export interface EnvDetail {
  env: EnvRow;
  providers: unknown[];
  api_keys: unknown[];
  sources: unknown[];
  recent_requests: unknown[];
}

function authHeaders(): HeadersInit {
  const cookieHeader = cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return {
    cookie: cookieHeader,
    'user-agent': headers().get('user-agent') ?? 'argus-dashboard',
  };
}

export async function listEnvsServerSide(): Promise<EnvRow[]> {
  const res = await fetch(`${API_BASE}/envs`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  if (res.status === 401) return [];
  if (!res.ok) throw new Error(`GET /envs failed: ${res.status}`);
  const data = (await res.json()) as { envs: EnvRow[] };
  return data.envs;
}

export async function getEnvServerSide(slug: string): Promise<EnvDetail | null> {
  const res = await fetch(`${API_BASE}/envs/${encodeURIComponent(slug)}`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  if (res.status === 404 || res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /envs/${slug} failed: ${res.status}`);
  return (await res.json()) as EnvDetail;
}
