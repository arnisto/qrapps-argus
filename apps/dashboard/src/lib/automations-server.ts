import 'server-only';
import { cookies, headers } from 'next/headers';

const API_BASE = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';

function authHeaders(): HeadersInit {
  const cookieStore = cookies();
  const h: Record<string, string> = {};
  const sess = cookieStore.get('argus_session');
  if (sess) h.cookie = `argus_session=${sess.value}`;
  const fwd = headers().get('x-forwarded-for');
  if (fwd) h['x-forwarded-for'] = fwd;
  return h;
}

export interface AutomationRow {
  id: string;
  env_id: string;
  name: string;
  prompt_text: string;
  compiled_plan: Record<string, unknown>;
  plan_compiler_model: string | null;
  plan_compiled_at: string | null;
  schedule_cron: string | null;
  schedule_tz: string;
  next_run_at: string | null;
  last_run_at: string | null;
  status: 'draft' | 'active' | 'paused' | 'disabled';
  consecutive_failures: number;
  daily_cost_cap_usd: string;
  per_run_token_cap: number;
  created_at: string;
  updated_at: string;
  /** From the list endpoint's lateral join. */
  run_count: number;
  last_run_status: string | null;
  last_run_started_at: string | null;
}

export async function listAutomationsServerSide(envSlug: string): Promise<AutomationRow[]> {
  const res = await fetch(
    `${API_BASE}/envs/${encodeURIComponent(envSlug)}/automations`,
    { headers: authHeaders(), cache: 'no-store' },
  );
  if (res.status === 401 || res.status === 404) return [];
  if (!res.ok) throw new Error(`GET /envs/${envSlug}/automations → ${res.status}`);
  const data = (await res.json()) as { automations: AutomationRow[] };
  return data.automations ?? [];
}
