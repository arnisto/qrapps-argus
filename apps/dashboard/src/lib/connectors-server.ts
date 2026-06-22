/**
 * SSR fetchers for the connectors marketplace.
 * Catalog is PUBLIC (no cookies needed) — the per-env list is authed.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';

const API_BASE = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

export type ConnectorKind = 'db' | 'channel' | 'tool' | 'doc';
export type ConnectorStatus = 'available' | 'coming_soon';

export interface CatalogField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'textarea';
  placeholder?: string;
  hint?: string;
  required?: boolean;
  default?: string | number;
  bucket: 'config' | 'secret';
  secret?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface CatalogEntry {
  subtype: string;
  kind: ConnectorKind;
  name: string;
  tagline: string;
  icon: string;
  status: ConnectorStatus;
  tags: string[];
  fields: CatalogField[];
  whatItUnlocks: string;
}

export interface ConnectedRow {
  id: string;
  kind: ConnectorKind;
  subtype: string;
  name: string;
  config: Record<string, unknown>;
  status: string;
  status_detail: string | null;
  last_synced_at: string | null;
  enabled: boolean;
  created_at: string;
  has_secret: boolean;
  source_count: number;
}

function authHeaders(): HeadersInit {
  return {
    cookie: cookies()
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join('; '),
    'user-agent': headers().get('user-agent') ?? 'argus-dashboard',
  };
}

export async function getCatalogServerSide(): Promise<CatalogEntry[]> {
  const res = await fetch(`${API_BASE}/connectors/catalog`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /connectors/catalog → ${res.status}`);
  const data = (await res.json()) as { catalog: CatalogEntry[] };
  return data.catalog;
}

export async function listConnectorsServerSide(envSlug: string): Promise<ConnectedRow[]> {
  const res = await fetch(
    `${API_BASE}/envs/${encodeURIComponent(envSlug)}/env-connectors`,
    { headers: authHeaders(), cache: 'no-store' },
  );
  if (res.status === 401 || res.status === 404) return [];
  if (!res.ok) throw new Error(`GET /envs/${envSlug}/env-connectors → ${res.status}`);
  const data = (await res.json()) as { connectors: ConnectedRow[] };
  return data.connectors;
}
