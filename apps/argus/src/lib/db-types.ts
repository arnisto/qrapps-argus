// Hand-written row types for the tables in supabase/migrations/20261103000001_init.sql.
// Replace with `supabase gen types typescript` once the project is linked.

export interface Company {
  id: string
  owner_id: string
  name: string
  slug: string
  description: string
  country: string
  city: string | null
  created_at: string
}

export interface Connection {
  id: string
  company_id: string
  provider: 'meta'
  external_user_id: string
  external_name: string | null
  token_ct: string
  token_iv: string
  scopes: string[]
  expires_at: string | null
  status: 'active' | 'expired' | 'revoked'
  created_at: string
}

export type SourceKind = 'own_page' | 'public_page' | 'ad_library_query'
export interface Source {
  id: string
  company_id: string
  connection_id: string | null
  kind: SourceKind
  external_id: string
  name: string
  config: Record<string, unknown>
  status: 'active' | 'pending_review' | 'paused' | 'error'
  last_error: string | null
  cursor: string | null
  created_at: string
}

export interface ObjectivePlan {
  watch: string[]
  signal_kinds: string[]
  ad_library_terms: string[]
}
export interface Objective {
  id: string
  company_id: string
  title: string
  description: string
  target_kind: 'market_watch'
  plan: ObjectivePlan
  cadence: 'daily' | 'weekly'
  status: 'proposed' | 'confirmed' | 'paused' | 'dismissed'
  proposed_by: 'ai' | 'default' | 'user'
  confirmed_at: string | null
  last_run_at: string | null
  last_report_at: string | null
  created_at: string
}

export interface CollectionRun {
  id: string
  objective_id: string
  trigger: 'cron' | 'manual'
  status: 'running' | 'ok' | 'partial' | 'failed'
  started_at: string
  finished_at: string | null
  items_seen: number
  items_new: number
  items_kept: number
  llm_tokens: number
  log: Array<{ at: string; msg: string }>
  error: string | null
}

export interface Signal {
  id: string
  objective_id: string
  raw_item_id: string | null
  kind: string
  summary: string
  value: { numbers?: Record<string, number>; entities?: string[] }
  importance: number
  reason: string
  created_at: string
}

export interface Report {
  id: string
  company_id: string
  objective_id: string
  period_start: string
  period_end: string
  title: string
  body_md: string
  evidence: unknown
  status: 'verified' | 'failed'
  critic: Array<{ claim: string; problem: string; detail: string }>
  created_at: string
}
