/**
 * Audit log — M9.1.
 *
 * Append-only writes to `audit_events`. The table itself enforces
 * append-only via Postgres triggers (see migration 0011); this module
 * is the typed call surface for the rest of the codebase.
 *
 * Rules:
 *   - NEVER log raw row content or summary text. Those live on
 *     `automation_runs` and get purged on `output_retention_days`.
 *     Audit captures META: who, what mode, which provider/region,
 *     what plan hash, what acks, what counts.
 *   - `org_id` is REQUIRED. Look it up via the env join if you only
 *     have an automation_id (see `writeAuditForAutomation`).
 *   - Best-effort: if the INSERT fails, log a warning and continue.
 *     The audit log is evidence, not a transaction gate — losing one
 *     row to a Postgres outage shouldn't fail the customer's run.
 */
import { db } from '../db.js';

export type AuditEventType =
  | 'automation.compiled'
  | 'automation.activated'
  | 'automation.paused'
  | 'automation.deleted'
  | 'run.started'
  | 'run.completed'
  | 'run.suppressed'
  | 'output_text.purged'
  | 'channel.message.deleted'
  | 'classifier.crawl.completed';

export interface AuditFields {
  event_type: AuditEventType;
  org_id: string;
  env_id?: string | null;
  actor_user_id?: string | null;
  automation_id?: string | null;
  run_id?: string | null;
  plan_hash?: string | null;
  redaction_mode?: string | null;
  provider?: string | null;
  provider_region?: string | null;
  ack_payload?: Record<string, unknown> | null;
  payload?: Record<string, unknown>;
}

/**
 * Write one row to audit_events. Best-effort — never throws to the caller.
 */
export async function writeAudit(fields: AuditFields): Promise<void> {
  try {
    await db().query(
      `INSERT INTO audit_events
              (event_type, org_id, env_id, actor_user_id, automation_id,
               run_id, plan_hash, redaction_mode, provider, provider_region,
               ack_payload, payload)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        fields.event_type,
        fields.org_id,
        fields.env_id ?? null,
        fields.actor_user_id ?? null,
        fields.automation_id ?? null,
        fields.run_id ?? null,
        fields.plan_hash ?? null,
        fields.redaction_mode ?? null,
        fields.provider ?? null,
        fields.provider_region ?? null,
        fields.ack_payload ? JSON.stringify(fields.ack_payload) : null,
        JSON.stringify(fields.payload ?? {}),
      ],
    );
  } catch (err) {
    // Stderr only — never fail the parent operation on an audit miss.
    // eslint-disable-next-line no-console
    console.warn('audit_events.write_failed', {
      event_type: fields.event_type,
      err: (err as Error).message,
    });
  }
}

/**
 * Convenience: write an audit row keyed by an automation_id. Looks up
 * org_id + env_id from the env join. Caller passes the partial event;
 * we fill in the org_id + env_id derived from the automation row.
 */
export async function writeAuditForAutomation(
  automationId: string,
  partial: Omit<AuditFields, 'org_id' | 'env_id' | 'automation_id'>,
): Promise<void> {
  const { rows } = await db().query<{ org_id: string; env_id: string }>(
    `SELECT e.org_id, a.env_id
       FROM automations a
       JOIN envs e ON e.id = a.env_id
      WHERE a.id = $1`,
    [automationId],
  );
  if (!rows[0]) return;
  await writeAudit({
    ...partial,
    org_id: rows[0].org_id,
    env_id: rows[0].env_id,
    automation_id: automationId,
  });
}
