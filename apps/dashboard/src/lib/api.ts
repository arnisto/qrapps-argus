/**
 * Server-side API client.
 *
 * Pages render in the dashboard container, so SSR must use the docker-network
 * hostname (`INTERNAL_API_URL`, e.g. http://api:4000) — `localhost` would
 * resolve to the dashboard container itself. The public URL is reserved for
 * any future client-side fetches.
 */
const BASE_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000';
const TOKEN = process.env.ARGUS_INGEST_TOKEN ?? '';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  // Only send `content-type: application/json` when there's actually a JSON
  // body. Fastify is strict — sending the header bodiless yields
  // `FST_ERR_CTP_EMPTY_JSON_BODY` (HTTP 400). This bit us on bodyless POSTs
  // like /v1/connectors/:id/test.
  const headers: Record<string, string> = {
    authorization: `Bearer ${TOKEN}`,
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    cache: 'no-store',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, `API ${res.status} on ${method} ${path}: ${text}`, text);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = <T>(path: string, init?: RequestInit): Promise<T> => {
  // Back-compat for existing callers passing RequestInit. Most call sites just
  // do `api<T>(path)` — those route through request().
  if (init) {
    return fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    }).then(async (r) => {
      if (!r.ok) throw new Error(`API ${r.status} on ${path}: ${await r.text()}`);
      return r.json() as Promise<T>;
    });
  }
  return request<T>('GET', path);
};

export const apiPost = <T>(path: string, body?: unknown): Promise<T> => request('POST', path, body);
export const apiPut = <T>(path: string, body?: unknown): Promise<T> => request('PUT', path, body);
export const apiDelete = <T>(path: string): Promise<T> => request('DELETE', path);

// ---------------------------------------------------------------------------
// DTOs — kept in sync with apps/api/src/routes/*.ts
// ---------------------------------------------------------------------------

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type OutputSchemaKind = 'text' | 'analysis' | 'finding';
export type ProviderId = 'claude' | 'openai' | 'gemini' | 'ollama' | 'deepseek' | 'mock';

export interface Finding {
  id: string;
  investigator_id: string;
  severity: Severity;
  summary: string;
  evidence: Array<{ event_id: string; reason: string }>;
  recommendation: string | null;
  impact_estimate: { currency: string; amount: number; basis: string } | null;
  created_at: string;
}

export interface Investigator {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity_threshold: Severity;
  source: 'builtin' | 'user';
  updated_at: string;
  /** v2 column. v1 rows return 1. */
  definition_schema_version: number;
  /** Returned by the list endpoint via LEFT JOIN; PG returns it as a string. */
  agent_count: string | number;
}

export interface InvestigatorDetail extends Investigator {
  definition: Record<string, unknown>;
  created_at: string;
}

export interface PipelineAgentEntry {
  agent_id: string;
  position: number;
  reads_from: 'all' | string[];
  name: string;
  provider: ProviderId;
  model: string;
  output_schema_kind: OutputSchemaKind;
  source: 'builtin' | 'user';
}

export interface Connector {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  /** Outcome of the most recent manual "Test now" — separate from polling-loop signals. */
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PostgresConnectorMapping {
  table: string;
  event_type: string;
  when?: string;
  fields: Record<string, string>;
  cursor: { column: string; strategy: 'gt' | 'gte' };
  subject?: { type: string; id_field: string };
}

export interface PostgresConnectorConfig {
  connection: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
  };
  mappings: PostgresConnectorMapping[];
  poll_interval_ms?: number;
  batch_size?: number;
}

export interface ConnectorDetail extends Connector {
  config: PostgresConnectorConfig;
}

export interface CrawledTable {
  table: string;
  row_count_estimate: number;
  columns: Array<{ name: string; data_type: string; nullable: boolean; default: string | null }>;
  primary_key: string[];
  foreign_keys: Array<{ column: string; references_table: string; references_column: string }>;
  samples: Array<Record<string, string>>;
}

export interface CrawledSchema {
  database: string;
  server_version: string;
  crawled_at: string;
  tables: CrawledTable[];
  mapped_tables: string[];
}

export interface ConnectorSchemaRow {
  schema_json: CrawledSchema;
  description: string | null;
  description_at: string | null;
  description_credential_id: string | null;
  crawled_at: string;
  crawl_error: string | null;
}

export interface ConnectorTestResult {
  ok: boolean;
  current_user?: string | null;
  server_version?: string | null;
  writable_tables_violation?: string[];
  mappings: Array<{ table: string; reachable: boolean; error?: string; row_count_estimate?: number }>;
  error?: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  provider: ProviderId;
  model: string;
  output_schema_kind: OutputSchemaKind;
  source: 'builtin' | 'user';
  created_at: string;
  updated_at: string;
}

export interface AgentDetail extends Agent {
  system_prompt: string;
  user_prompt_template: string | null;
}

export interface LlmCredential {
  id: string;
  name: string;
  provider: ProviderId;
  default_model: string | null;
  is_default: boolean;
  notes: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface LlmCredentialDetail extends LlmCredential {
  /** Always `"__REDACTED__"` on GET — write-only via POST/PUT. */
  api_key: string;
}

export type AlertChannelType = 'slack' | 'discord' | 'webhook';

export interface AlertChannel {
  id: string;
  type: AlertChannelType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
}

/** Per-type config shapes. min_severity is universal across types. */
export interface SlackChannelConfig {
  webhook_url?: string;
  webhook_url_env?: string;
  min_severity?: Severity;
}
export interface DiscordChannelConfig {
  webhook_url?: string;
  webhook_url_env?: string;
  min_severity?: Severity;
}
export interface WebhookChannelConfig {
  url: string;
  secret_env?: string;
  min_severity?: Severity;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  agent_name: string | null;
  position: number;
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  finished_at: string | null;
  provider: string;
  model: string;
  system_prompt_rendered: string;
  user_prompt_rendered: string;
  output_json: unknown | null;
  output_text: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  error: string | null;
}

export interface InvestigationDetail {
  id: string;
  investigator_id: string;
  status: 'running' | 'succeeded' | 'failed';
  started_at: string;
  finished_at: string | null;
  provider: string | null;
  model: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  error: string | null;
}

export interface HealthSnapshot {
  generated_at: string;
  queues: Record<
    string,
    { waiting: number; active: number; delayed: number; failed: number; completed: number }
  >;
  activity: {
    events_24h: string;
    investigations_24h: string;
    investigations_succeeded_24h: string;
    investigations_failed_24h: string;
    findings_24h: string;
  };
  currently_running: Array<{
    id: string;
    investigator_id: string;
    started_at: string;
    age_s: number;
  }>;
  top_failing_investigators: Array<{
    investigator_id: string;
    name: string | null;
    fails: number;
    runs: number;
    fail_rate: number;
  }>;
  top_failing_agents: Array<{
    agent_id: string;
    agent_name: string | null;
    fails: number;
    last_error: string | null;
  }>;
  recent_failures: Array<{
    id: string;
    investigator_id: string;
    started_at: string;
    finished_at: string | null;
    error: string;
  }>;
  repetitive_findings: Array<{
    investigator_id: string;
    summary_prefix: string;
    occurrences: number;
    last_seen: string;
  }>;
  connectors: Array<{
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    last_sync_at: string | null;
    last_error: string;
    last_test_at: string | null;
    last_test_ok: boolean | null;
    last_test_error: string;
  }>;
  channels: Array<{
    channel_id: string;
    name: string;
    type: string;
    enabled: boolean;
    min_severity: string | null;
    sent_24h: number;
    failed_24h: number;
  }>;
  severity_breakdown_24h: Array<{ severity: string; n: number }>;
  alerts_backlog: { pending: number; failed: number; oldest_pending_age_s: number | null };
}
