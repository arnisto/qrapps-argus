/**
 * The runner. One function: take an automation, run it once, write the result.
 *
 * Reused by the cron dispatcher, the "Run now" manual trigger, and the
 * "Preview" path (with sendEnabled=false so Slack doesn't receive).
 *
 * The 3-step pipeline:
 *
 *   1. READ   — runQueryViaConnector(plan.read.connector_id, sql_template)
 *   2. RENDER — Gemini/Groq generates the summary text from the rows
 *   3. SEND   — channel adapter posts the text (skipped on preview)
 *
 * Failure semantics, cost caps, idempotency — all here. See
 * ARCHITECTURE_AUTOMATIONS.md §5 / §6.
 */
import { db } from '../db.js';
import { chatComplete } from '../llm/router.js';
import { loadProviderForEnv } from '../routes/providers.js';
import type { ProviderRow } from '../llm/gemini.js';
import { runQueryViaConnector } from '../agent/db-query.js';
import { send as slackSend } from '../connectors/adapters/slack.js';
import { decryptKey } from '../llm/secret.js';
import type { CompiledPlan } from './compiler.js';
import type { SlackConfig, SlackSecret } from '../connectors/adapters/slack.js';
import { nextRun } from './schedule.js';

interface AutomationRow {
  id: string;
  env_id: string;
  name: string;
  prompt_text: string;
  compiled_plan: CompiledPlan | Record<string, unknown>;
  schedule_cron: string | null;
  schedule_tz: string;
  status: string;
  consecutive_failures: number;
  daily_cost_cap_usd: string;
  per_run_token_cap: number;
}

type RunOpts = {
  trigger: 'cron' | 'manual' | 'preview';
  occurrence_ts: Date;
  /** false for preview — runs read+render but skips send. */
  sendEnabled: boolean;
};

interface StepRecord {
  kind: 'read' | 'render' | 'send';
  ok: boolean;
  latency_ms: number;
  [k: string]: unknown;
}

export interface RunOutcome {
  status: 'ok' | 'failed' | 'suppressed' | 'cancelled';
  output_text?: string;
  tokens_used?: number;
  cost_usd?: number;
  error_class?: string;
  error_detail?: string;
  step_trace: StepRecord[];
}

const RENDER_SYSTEM = `You are a concise data summariser for an internal operations channel. Be terse, lead with the most interesting trend, cite specific numbers from the data. Output ONLY the summary text — no preamble, no caveats about what you don't know.`;

const FALLBACK_TEMPLATE = `Summarise these rows clearly and concisely.\n\nData:\n{{rows}}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runOnce(
  automationId: string,
  opts: RunOpts,
): Promise<RunOutcome> {
  const automation = await loadAutomation(automationId);
  if (!automation) {
    return failOutcome('not_found', 'automation_not_found', []);
  }

  const plan = automation.compiled_plan as CompiledPlan;
  if (!hasCompiledPlan(plan)) {
    return failOutcome('not_compiled', 'no_compiled_plan', []);
  }

  // Daily-cost-cap check (only for cron runs; manual + preview bypass).
  if (opts.trigger === 'cron') {
    const spent = await spentTodayUsd(automationId);
    if (spent >= Number(automation.daily_cost_cap_usd)) {
      const trace: StepRecord[] = [
        {
          kind: 'read',
          ok: false,
          latency_ms: 0,
          suppressed: true,
          reason: 'daily_cost_cap',
          spent_usd: spent,
          cap_usd: Number(automation.daily_cost_cap_usd),
        },
      ];
      return {
        status: 'suppressed',
        error_class: 'budget_daily',
        error_detail: `Daily cap of $${automation.daily_cost_cap_usd} reached ($${spent.toFixed(4)} spent).`,
        step_trace: trace,
      };
    }
  }

  // Idempotency anchor: try to claim the run row first. UNIQUE(automation_id,
  // occurrence_ts) means a second worker for the same scheduled slot will
  // 23505 and we short-circuit to 'suppressed' with the existing row.
  const claim = await claimRun(automationId, automation.env_id, opts);
  if (!claim.claimed) {
    // Another worker already started this occurrence. Short-circuit.
    return {
      status: 'suppressed',
      error_class: 'duplicate_occurrence',
      error_detail: 'A worker already started this scheduled slot.',
      step_trace: [],
    };
  }

  const trace: StepRecord[] = [];
  let outcome: RunOutcome;

  try {
    // ---- READ ----
    const readT0 = Date.now();
    const readResult = await runQueryViaConnector(
      automation.env_id,
      plan.read.connector_id,
      plan.read.sql_template,
    );
    trace.push({
      kind: 'read',
      ok: readResult.ok,
      latency_ms: Date.now() - readT0,
      connector_id: plan.read.connector_id,
      sql: plan.read.sql_template,
      rows_returned: readResult.rows_returned,
      truncated: readResult.truncated,
      error: readResult.error,
    });
    if (!readResult.ok) {
      throw new RunError('connector_permanent', `read step failed: ${readResult.error}`);
    }

    // ---- RENDER ----
    const renderT0 = Date.now();
    const provider = await loadProviderForRender(automation.env_id);
    const template = plan.render.user_template || FALLBACK_TEMPLATE;
    const userMessage = template.includes('{{rows}}')
      ? template.replace(/\{\{rows\}\}/g, readResult.rows_text ?? '(no rows)')
      : `${template}\n\nData:\n${readResult.rows_text ?? '(no rows)'}`;

    const chat = await chatComplete(provider, plan.render.model, [
      { role: 'system', content: RENDER_SYSTEM },
      { role: 'user', content: userMessage },
    ], {
      temperature: 0.2,
      max_tokens: Math.min(automation.per_run_token_cap, 2048),
    });
    const summaryText = chat.choices?.[0]?.message?.content?.trim() ?? '';
    const tokens = chat.usage?.total_tokens ?? 0;
    if (tokens > automation.per_run_token_cap) {
      throw new RunError('budget_per_run', `tokens used (${tokens}) exceeded per-run cap (${automation.per_run_token_cap})`);
    }
    trace.push({
      kind: 'render',
      ok: true,
      latency_ms: Date.now() - renderT0,
      model: plan.render.model,
      tokens,
      text_chars: summaryText.length,
    });

    // ---- SEND ----
    if (!opts.sendEnabled) {
      // Preview path — return the generated text WITHOUT touching the channel.
      outcome = {
        status: 'ok',
        output_text: summaryText,
        tokens_used: tokens,
        cost_usd: estimateCostUsd(plan.render.model, tokens),
        step_trace: trace,
      };
    } else {
      const sendT0 = Date.now();
      const sendResult = await dispatchSend(
        automation.env_id,
        plan.send,
        summaryText,
      );
      trace.push({
        kind: 'send',
        ok: sendResult.ok,
        latency_ms: Date.now() - sendT0,
        connector_id: plan.send.connector_id,
        channel: plan.send.channel,
        external_id: sendResult.external_id,
        error: sendResult.error,
      });
      if (!sendResult.ok) {
        throw new RunError('connector_permanent', `send step failed: ${sendResult.error}`);
      }
      outcome = {
        status: 'ok',
        output_text: summaryText,
        tokens_used: tokens,
        cost_usd: estimateCostUsd(plan.render.model, tokens),
        step_trace: trace,
      };
    }
  } catch (err) {
    const e = err as Error & { errClass?: string };
    outcome = {
      status: 'failed',
      error_class: e.errClass ?? 'unknown',
      error_detail: e.message,
      step_trace: trace,
    };
  }

  // ---- Persist outcome ----
  await persistOutcome(claim.runId, outcome);
  await advanceAutomationState(automation, outcome, opts.trigger);

  return outcome;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class RunError extends Error {
  errClass: string;
  constructor(errClass: string, msg: string) {
    super(msg);
    this.errClass = errClass;
  }
}

async function loadAutomation(id: string): Promise<AutomationRow | null> {
  const { rows } = await db().query<AutomationRow>(
    `SELECT id, env_id, name, prompt_text, compiled_plan, schedule_cron,
            schedule_tz, status, consecutive_failures, daily_cost_cap_usd,
            per_run_token_cap
       FROM automations WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

function hasCompiledPlan(p: unknown): p is CompiledPlan {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return Boolean(o.read && o.render && o.send);
}

async function spentTodayUsd(automationId: string): Promise<number> {
  const { rows } = await db().query<{ total: string }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::text AS total
       FROM automation_runs
      WHERE automation_id = $1
        AND started_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`,
    [automationId],
  );
  return Number(rows[0]?.total ?? 0);
}

async function claimRun(
  automationId: string,
  envId: string,
  opts: RunOpts,
): Promise<{ claimed: boolean; runId: string | null }> {
  // ON CONFLICT DO NOTHING returns rowCount=0 if the row already exists;
  // we then look up the existing row to return its id (for diagnostics).
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO automation_runs
            (automation_id, env_id, occurrence_ts, trigger, status, started_at)
            VALUES ($1, $2, $3, $4, 'running', now())
       ON CONFLICT (automation_id, occurrence_ts) DO NOTHING
    RETURNING id`,
    [automationId, envId, opts.occurrence_ts.toISOString(), opts.trigger],
  );
  if (rows[0]) return { claimed: true, runId: rows[0].id };
  // Already exists — pull the id for the trace.
  const { rows: ex } = await db().query<{ id: string }>(
    `SELECT id FROM automation_runs
      WHERE automation_id = $1 AND occurrence_ts = $2`,
    [automationId, opts.occurrence_ts.toISOString()],
  );
  return { claimed: false, runId: ex[0]?.id ?? null };
}

async function persistOutcome(runId: string | null, outcome: RunOutcome): Promise<void> {
  if (!runId) return;
  await db().query(
    `UPDATE automation_runs
        SET status = $1,
            finished_at = now(),
            step_trace = $2::jsonb,
            output_text = $3,
            tokens_used = $4,
            cost_usd = $5,
            error_class = $6,
            error_detail = $7
      WHERE id = $8`,
    [
      outcome.status,
      JSON.stringify(outcome.step_trace),
      outcome.output_text ?? null,
      outcome.tokens_used ?? null,
      outcome.cost_usd ?? null,
      outcome.error_class ?? null,
      outcome.error_detail ?? null,
      runId,
    ],
  );
}

async function advanceAutomationState(
  automation: AutomationRow,
  outcome: RunOutcome,
  trigger: 'cron' | 'manual' | 'preview',
): Promise<void> {
  // Preview never mutates schedule or failure counters — that's its
  // whole point.
  if (trigger === 'preview') return;

  // Compute next_run_at if this was a cron run.
  let nextAt: Date | null = null;
  if (trigger === 'cron' && automation.schedule_cron) {
    const next = nextRun(automation.schedule_cron, automation.schedule_tz);
    if (next) nextAt = next.next_run_at;
  }

  // Permanent failures increment consecutive_failures. Provider 5xx /
  // budget errors do NOT (they're transient or operator-actionable).
  const isPermanentFailure =
    outcome.status === 'failed' &&
    outcome.error_class !== 'provider_5xx' &&
    !outcome.error_class?.startsWith('budget_');

  const newFailureCount = outcome.status === 'ok'
    ? 0
    : isPermanentFailure
      ? automation.consecutive_failures + 1
      : automation.consecutive_failures;

  // Auto-pause after 5 consecutive permanent failures.
  const shouldAutoPause = newFailureCount >= 5;

  await db().query(
    `UPDATE automations
        SET last_run_at = now(),
            consecutive_failures = $1,
            status = CASE WHEN $2::boolean THEN 'paused'::automation_status ELSE status END,
            next_run_at = CASE WHEN $2::boolean THEN NULL ELSE $3::timestamptz END,
            updated_at = now()
      WHERE id = $4`,
    [newFailureCount, shouldAutoPause, nextAt?.toISOString() ?? null, automation.id],
  );
}

async function loadProviderForRender(envId: string): Promise<ProviderRow> {
  const { rows } = await db().query<{ name: string }>(
    `SELECT name FROM providers WHERE env_id = $1 AND enabled
      ORDER BY (name = 'gemini') DESC, created_at LIMIT 1`,
    [envId],
  );
  if (!rows[0]) throw new RunError('no_provider', 'No provider connected for render step');
  const provider = await loadProviderForEnv(envId, rows[0].name as 'gemini' | 'groq');
  if (!provider) throw new RunError('no_provider', `Provider ${rows[0].name} couldn't load`);
  return provider;
}

async function dispatchSend(
  envId: string,
  send: CompiledPlan['send'],
  text: string,
): Promise<{ ok: boolean; external_id?: string; error?: string }> {
  // Load the channel connector's secrets.
  const { rows } = await db().query<{
    config: Record<string, unknown>;
    secret_ct: Buffer;
    secret_iv: Buffer;
    subtype: string;
  }>(
    `SELECT subtype, config, secret_ct, secret_iv
       FROM env_connectors
      WHERE id = $1 AND env_id = $2 AND enabled`,
    [send.connector_id, envId],
  );
  const conn = rows[0];
  if (!conn) return { ok: false, error: 'send_connector_not_found' };

  if (conn.subtype === 'slack') {
    const sec = JSON.parse(
      decryptKey({ ct: conn.secret_ct, iv: conn.secret_iv }),
    ) as SlackSecret;
    const cfg = conn.config as unknown as SlackConfig;
    const channel = send.channel || cfg.default_channel || '';
    if (!channel) return { ok: false, error: 'no_channel_resolvable' };
    const out = await slackSend(cfg, sec, { channel, text });
    return out.ok
      ? { ok: true, external_id: `${out.channel}:${out.ts}` }
      : { ok: false, error: out.error };
  }

  return { ok: false, error: `send_subtype_${conn.subtype}_not_supported_yet` };
}

function failOutcome(errClass: string, detail: string, trace: StepRecord[]): RunOutcome {
  return { status: 'failed', error_class: errClass, error_detail: detail, step_trace: trace };
}

// Crude cost estimate. Gemini Flash is ~$0.10/M tokens output, Groq Llama
// is ~$0.59/M for 70B. Real per-run accounting can land later.
function estimateCostUsd(model: string, tokens: number): number {
  const perMillion =
    model.startsWith('gemini-2.5-flash') ? 0.30
    : model.startsWith('gemini') ? 0.50
    : model.startsWith('llama-3.3-70b') ? 0.79
    : 1.0;
  return (tokens / 1_000_000) * perMillion;
}
