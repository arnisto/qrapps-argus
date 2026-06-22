/**
 * Server-side fetchers for per-env provider / api-key / source data.
 * Forwards inbound cookies so Fastify's session gate sees the user.
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

export interface ProviderRow {
  id: string;
  name: string;
  default_model: string;
  base_url: string | null;
  enabled: boolean;
  has_key: boolean;
  created_at: string;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  rate_per_min: number;
  enabled: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface SourceRow {
  id: string;
  kind: 'file' | 'qa';
  title: string;
  uri: string | null;
  bytes: number | null;
  authority: number;
  created_at: string;
  chunks: number;
}

async function fetchList<T>(envSlug: string, sub: string, key: keyof never): Promise<T[]> {
  const res = await fetch(
    `${API_BASE}/envs/${encodeURIComponent(envSlug)}/${sub}`,
    { headers: authHeaders(), cache: 'no-store' },
  );
  if (res.status === 401 || res.status === 404) return [];
  if (!res.ok) throw new Error(`GET /envs/${envSlug}/${sub} → ${res.status}`);
  const data = (await res.json()) as Record<string, T[]>;
  return data[key as string] ?? [];
}

export const listProviders = (slug: string) =>
  fetchList<ProviderRow>(slug, 'providers', 'providers');

export const listApiKeys = (slug: string) =>
  fetchList<ApiKeyRow>(slug, 'api-keys', 'api_keys');

export const listSources = (slug: string) =>
  fetchList<SourceRow>(slug, 'sources', 'sources');
