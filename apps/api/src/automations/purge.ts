/**
 * Nightly output purge — M9.1.
 *
 * Run once per day, nulls `automation_runs.output_text` (and `error_detail`)
 * for runs older than each automation's `output_retention_days`. Row stays
 * — only the rendered/sent content is removed.
 *
 * The audit row stays forever; only the content is purged. A regulator can
 * still prove "automation X ran on date Y under mode Z with N tokens" via
 * audit_events; they just can't reconstruct what got posted.
 *
 * Lives in the same Fastify-process BullMQ as the automations dispatcher.
 * One repeatable job, scheduled daily at 03:00 UTC by default (configurable
 * via env). Idempotent: re-running mid-day just no-ops on rows already
 * nulled.
 */
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db.js';
import { writeAudit } from './audit.js';

const QUEUE_NAME = 'automation.purge';
const REPEAT_CRON = process.env.ARGUS_PURGE_CRON ?? '0 3 * * *'; // 03:00 UTC daily
const REPEAT_TZ = 'UTC';

let queue: Queue | null = null;
let worker: Worker | null = null;

function redisConnection(): ConnectionOptions {
  const raw = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}

/**
 * Start the purger. Called once from server boot alongside the dispatcher.
 * Idempotent — second call returns early.
 */
export async function startPurger(log: FastifyBaseLogger): Promise<void> {
  if (queue || worker) {
    log.warn('automation_purger.already_started');
    return;
  }
  const connection = redisConnection();
  queue = new Queue(QUEUE_NAME, { connection });
  worker = new Worker(
    QUEUE_NAME,
    async () => {
      const summary = await runPurgeOnce(log);
      return summary;
    },
    {
      connection,
      concurrency: 1, // one purge at a time — never parallel
    },
  );

  // Register the repeatable schedule. Using { pattern, tz, jobId } so re-running
  // startPurger doesn't multiply jobs (jobId pins it).
  await queue.add(
    'purge',
    {},
    {
      jobId: 'automation.purge.daily',
      repeat: { pattern: REPEAT_CRON, tz: REPEAT_TZ },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );

  log.info({ pattern: REPEAT_CRON, tz: REPEAT_TZ }, 'automation_purger.started');
}

interface PurgeSummary {
  rows_nulled: number;
  by_org: Array<{ org_id: string; rows: number }>;
}

/**
 * Idempotent purge pass. Joins back to automations to read each row's
 * `output_retention_days`. Single UPDATE per env to keep round-trips low.
 *
 * The DELETE-vs-NULL choice matters: we NULL output_text + error_detail but
 * KEEP the run row so audit cross-refs still resolve (`automation_runs.id`
 * is the FK target on `audit_events.run_id`).
 */
export async function runPurgeOnce(log: FastifyBaseLogger): Promise<PurgeSummary> {
  // Stamp the cutoff once so the UPDATE + the audit write agree.
  const startedAt = new Date();
  const { rows: nulledRows } = await db().query<{ env_id: string; org_id: string; rows_nulled: string }>(
    `WITH nulled AS (
       UPDATE automation_runs r
          SET output_text = NULL,
              error_detail = NULL
         FROM automations a
         JOIN envs e ON e.id = a.env_id
        WHERE r.automation_id = a.id
          AND r.finished_at IS NOT NULL
          AND r.finished_at < now() - (a.output_retention_days * interval '1 day')
          AND (r.output_text IS NOT NULL OR r.error_detail IS NOT NULL)
        RETURNING r.env_id, e.org_id
     )
     SELECT env_id, org_id, count(*)::text AS rows_nulled
       FROM nulled
       GROUP BY env_id, org_id`,
  );

  let total = 0;
  for (const row of nulledRows) {
    const n = Number(row.rows_nulled);
    total += n;
    void writeAudit({
      event_type: 'output_text.purged',
      org_id: row.org_id,
      env_id: row.env_id,
      payload: {
        rows_nulled: n,
        run_at: startedAt.toISOString(),
      },
    });
  }

  if (total > 0) {
    log.info(
      { rows_nulled: total, envs_touched: nulledRows.length },
      'automation_purger.completed',
    );
  } else {
    log.debug('automation_purger.no_op');
  }

  return {
    rows_nulled: total,
    by_org: nulledRows.map((r) => ({ org_id: r.org_id, rows: Number(r.rows_nulled) })),
  };
}

/** Stop the purger cleanly on shutdown. */
export async function stopPurger(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
