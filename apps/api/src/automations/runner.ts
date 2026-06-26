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
import {
  loadClassificationsForConnector,
  maskRowsText,
  RefusedColumnError,
  rewriteSelectList,
  scanOutputForSecretValues,
  type RedactionMode,
} from './redactor/index.js';
import { writeAuditForAutomation } from './audit.js';

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
  /** M9.1 — safety knobs. Default 'mask-sensitive' for any pre-existing row. */
  redaction_mode: RedactionMode;
  /** M9.1 — operator activation gate. Required by validateActivationGate(). */
  acknowledged_at: string | null;
  acknowledgements: Record<string, unknown>;
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

// M9.1 — per-mode system prompts.
// The previous single RENDER_SYSTEM said "cite specific numbers from the data"
// which actively works against safety in mask-sensitive mode (encourages the
// model to echo placeholders verbatim). Each mode now gets its own contract.
const RENDER_SYSTEM_BY_MODE: Record<RedactionMode, string> = {
  'mask-sensitive': `You are summarising data that has been pre-redacted by an upstream safety layer. Placeholders like <email#1>, <phone#2>, <pii>, <quasi-id> are INTENTIONAL — they hide real values from you.

RULES:
  - DO NOT invent values to replace placeholders.
  - DO NOT echo placeholders verbatim. Describe categorically ("one customer email was logged", "two unique users").
  - Cite aggregate numbers (counts, sums, averages) freely.
  - NEVER quote any string that looks like an email, phone number, name, address, IBAN, or token — even if it isn't masked.
  - If the only interesting fact is a redacted value, say "one user matched this criterion" without naming them.
  - Output ONLY the summary text — no preamble, no caveats about what you can't see.`,

  'aggregate-only': `You are summarising aggregate data only — counts, sums, averages, distributions. The upstream safety layer has rejected any per-row identifier from this query.

RULES:
  - If you see anything that looks like a per-row identifier (specific email, name, phone), that is a bug — refuse to summarise and explicitly say "the data appears to contain unexpected per-row identifiers; refusing".
  - Cite aggregate numbers exactly as given.
  - Output ONLY the summary text — no preamble.`,

  'raw-passthrough': `You are a concise data summariser for an internal operations channel. Be terse, lead with the most interesting trend, cite specific numbers from the data. Output ONLY the summary text — no preamble, no caveats about what you don't know.`,
};

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

  // M9.1 — audit: run.started. Captures mode + trigger; no payload content.
  void writeAuditForAutomation(automationId, {
    event_type: 'run.started',
    run_id: claim.runId,
    redaction_mode: automation.redaction_mode,
    payload: { trigger: opts.trigger, occurrence_ts: opts.occurrence_ts.toISOString() },
  });

  const trace: StepRecord[] = [];
  let outcome: RunOutcome;

  try {
    // M9.1 — load this connector's column classifications once for the run.
    // The redactor needs them at both rewriteSelectList (compile of safe SQL)
    // and maskRowsText (cell-value safety net). One DB round-trip per run.
    const classifications = await loadClassificationsForConnector(plan.read.connector_id);
    const mode: RedactionMode = automation.redaction_mode;

    // ---- REDACTOR — SQL REWRITE ----
    // Refuses secret-class columns, drops/replaces pii per mode.
    let safeSql: string;
    let rewriteSummary: { dropped: string[]; replaced: string[]; refused: string[]; changed: boolean };
    try {
      const rw = rewriteSelectList(plan.read.sql_template, classifications, mode);
      safeSql = rw.sql;
      rewriteSummary = {
        dropped: rw.dropped,
        replaced: rw.replaced,
        refused: rw.refused,
        changed: rw.changed,
      };
    } catch (err) {
      if (err instanceof RefusedColumnError) {
        trace.push({
          kind: 'read',
          ok: false,
          latency_ms: 0,
          connector_id: plan.read.connector_id,
          sql: plan.read.sql_template,
          refused_columns: err.refused,
        });
        throw new RunError(
          'refused_column',
          `Refused to send: column(s) classified as secret — ${err.refused.join(', ')}`,
        );
      }
      throw new RunError('safety_rewrite_failed', (err as Error).message);
    }

    // ---- READ ----
    const readT0 = Date.now();
    const readResult = await runQueryViaConnector(
      automation.env_id,
      plan.read.connector_id,
      safeSql,
    );

    // ---- REDACTOR — CELL VALUE MASKING ----
    // Catches values that slipped through SQL rewrite (aliased columns,
    // subquery projections, free-text columns containing PII). No-op in
    // raw-passthrough mode.
    const mask = maskRowsText(readResult.rows_text ?? '', mode);

    trace.push({
      kind: 'read',
      ok: readResult.ok,
      latency_ms: Date.now() - readT0,
      connector_id: plan.read.connector_id,
      sql_original: plan.read.sql_template,
      sql_executed: safeSql,
      rewrite: rewriteSummary,
      mask: {
        masked_counts: mask.masked_counts,
        tokens_minted: mask.tokens_minted,
      },
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
      ? template.replace(/\{\{rows\}\}/g, mask.rows_text || '(no rows)')
      : `${template}\n\nData:\n${mask.rows_text || '(no rows)'}`;

    const chat = await chatComplete(provider, plan.render.model, [
      { role: 'system', content: RENDER_SYSTEM_BY_MODE[mode] },
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

    // ---- POST-RENDER LEAK SCAN ----
    // Defence in depth: if the LLM hallucinated or echoed a token-shaped
    // value, refuse to send. This is the load-bearing gate for the bright
    // line — even if rewrite + mask let something through, this catches it
    // before it reaches the channel.
    const leakHits = scanOutputForSecretValues(summaryText);
    if (leakHits.length > 0) {
      trace.push({
        kind: 'render',
        ok: false,
        latency_ms: Date.now() - renderT0,
        model: plan.render.model,
        tokens,
        text_chars: summaryText.length,
        leak_detected: leakHits,
      });
      throw new RunError(
        'leak_detected_in_output',
        `Post-render scan matched secret-shaped values (${leakHits.length}); refusing to send.`,
      );
    }

    trace.push({
      kind: 'render',
      ok: true,
      latency_ms: Date.now() - renderT0,
      model: plan.render.model,
      mode,
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

  // M9.1 — audit: run.completed or run.suppressed. Counts only, no content.
  // payload omits output_text + raw rows on purpose (those purge on retention).
  const eventType: 'run.completed' | 'run.suppressed' =
    outcome.status === 'suppressed' ? 'run.suppressed' : 'run.completed';
  void writeAuditForAutomation(automationId, {
    event_type: eventType,
    run_id: claim.runId,
    redaction_mode: automation.redaction_mode,
    provider: (plan.render as { model?: string }).model ?? null,
    payload: {
      status: outcome.status,
      tokens_used: outcome.tokens_used ?? null,
      cost_usd: outcome.cost_usd ?? null,
      error_class: outcome.error_class ?? null,
      // Counts from rewrite + mask so a regulator can prove safety ran;
      // we never log the values themselves.
      rewrite_dropped: countTraceField(trace, 'rewrite', 'dropped'),
      rewrite_replaced: countTraceField(trace, 'rewrite', 'replaced'),
      rewrite_refused: countTraceField(trace, 'rewrite', 'refused'),
      mask_counts: extractMaskCounts(trace),
    },
  });

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

// ---------------------------------------------------------------------------
// M9.1 — small helpers for audit payload summarisation. They read trace
// entries and return counts so we never log raw values in audit_events.
// ---------------------------------------------------------------------------
function countTraceField(
  trace: StepRecord[],
  kind: 'rewrite',
  field: 'dropped' | 'replaced' | 'refused',
): number {
  for (const t of trace) {
    if (kind === 'rewrite' && t.kind === 'read') {
      const rw = (t as { rewrite?: Record<string, string[]> }).rewrite;
      if (rw && Array.isArray(rw[field])) return rw[field].length;
    }
  }
  return 0;
}

function extractMaskCounts(trace: StepRecord[]): Record<string, number> {
  for (const t of trace) {
    if (t.kind === 'read') {
      const m = (t as { mask?: { masked_counts: Record<string, number> } }).mask;
      if (m?.masked_counts) return m.masked_counts;
    }
  }
  return {};
}

async function loadAutomation(id: string): Promise<AutomationRow | null> {
  const { rows } = await db().query<AutomationRow>(
    `SELECT id, env_id, name, prompt_text, compiled_plan, schedule_cron,
            schedule_tz, status, consecutive_failures, daily_cost_cap_usd,
            per_run_token_cap, redaction_mode, acknowledged_at, acknowledgements
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
