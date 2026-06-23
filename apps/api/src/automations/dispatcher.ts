/**
 * The dispatcher. One singleton inside the Fastify process, ticking every
 * 5 seconds, that:
 *
 *   1. Scans `automations` for rows where next_run_at < now() AND
 *      status='active', limit 500.
 *   2. For each, CAS-advances next_run_at to the next slot, enqueues a
 *      one-off `automation.run` job with jobId = `auto:<id>:<occurrence_ts>`
 *      (idempotent across crashes).
 *
 * A separate BullMQ Worker consumes the `automation.run` queue and
 * invokes runOnce() from runner.ts.
 *
 * Why this shape vs. one BullMQ repeatable per automation: at 100k
 * automations, repeatables would dominate the Redis keyspace and become
 * unqueryable. Postgres-as-schedule-truth + one repeatable tick scales
 * cleanly; see ARCHITECTURE_AUTOMATIONS.md §1.3.
 */
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db.js';
import { nextRun } from './schedule.js';
import { runOnce } from './runner.js';

const QUEUE_NAME = 'automation.run';
const TICK_INTERVAL_MS = 5_000;
const SCAN_LIMIT = 500;

let queue: Queue | null = null;
let worker: Worker | null = null;
let dispatcherTimer: NodeJS.Timeout | null = null;

interface DueRow {
  id: string;
  env_id: string;
  schedule_cron: string;
  schedule_tz: string;
  next_run_at: string;
}

interface RunJob {
  automation_id: string;
  occurrence_ts: string;
  trigger: 'cron' | 'manual';
}

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
 * Start the dispatcher + worker. Called from server.ts during boot.
 * Idempotent — safe to call twice (returns early if already started).
 */
export async function startAutomationDispatcher(log: FastifyBaseLogger): Promise<void> {
  if (queue || worker || dispatcherTimer) {
    log.warn('automation_dispatcher.already_started');
    return;
  }

  const connection = redisConnection();
  queue = new Queue<RunJob>(QUEUE_NAME, { connection });
  worker = new Worker<RunJob>(
    QUEUE_NAME,
    async (job) => {
      const { automation_id, occurrence_ts, trigger } = job.data;
      const result = await runOnce(automation_id, {
        trigger,
        occurrence_ts: new Date(occurrence_ts),
        sendEnabled: true,
      });
      return result;
    },
    {
      connection,
      // Per-system concurrency. Per-org caps are enforced inside runOnce
      // (deferred — for M8.3 the global cap is enough at the user's stated
      // 1000-automations-per-install scale).
      concurrency: 50,
    },
  );
  worker.on('failed', (job, err) => {
    log.error(
      { jobId: job?.id, err: err.message },
      'automation.run.failed',
    );
  });

  // The tick. Single-process: no leader election needed because the
  // dispatcher is bound to the Fastify process. When we scale to multiple
  // API replicas, switch to advisory-lock leader election (TODO M8+).
  dispatcherTimer = setInterval(() => {
    void tick(log).catch((err: unknown) => {
      log.error({ err: (err as Error).message }, 'automation_dispatcher.tick.error');
    });
  }, TICK_INTERVAL_MS);
  // Run one tick immediately on boot so newly-active automations that are
  // already-due fire without waiting 5s.
  void tick(log).catch((err: unknown) => {
    log.error({ err: (err as Error).message }, 'automation_dispatcher.boot_tick.error');
  });

  log.info(
    { tick_ms: TICK_INTERVAL_MS, scan_limit: SCAN_LIMIT, concurrency: 50 },
    'automation_dispatcher.started',
  );
}

async function tick(log: FastifyBaseLogger): Promise<void> {
  // Snapshot the due rows. The partial index automations_due_idx makes
  // this O(due-rows) regardless of total table size.
  const { rows } = await db().query<DueRow>(
    `SELECT id, env_id, schedule_cron, schedule_tz, next_run_at
       FROM automations
      WHERE status = 'active'
        AND next_run_at IS NOT NULL
        AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT $1`,
    [SCAN_LIMIT],
  );
  if (rows.length === 0) return;

  for (const row of rows) {
    // The CAS dance: advance next_run_at iff it's still what we observed.
    // If another dispatcher (or a manual trigger) already moved it, our
    // UPDATE affects 0 rows and we skip enqueuing.
    const next = row.schedule_cron
      ? nextRun(row.schedule_cron, row.schedule_tz, new Date(row.next_run_at))
      : null;

    const occurrence_ts = row.next_run_at;
    const newNextAt = next?.iso ?? null;

    const upd = await db().query(
      `UPDATE automations
          SET next_run_at = $1,
              updated_at = now()
        WHERE id = $2 AND next_run_at = $3 AND status = 'active'`,
      [newNextAt, row.id, row.next_run_at],
    );
    if (upd.rowCount === 0) continue; // someone else got it first

    // Enqueue. The jobId is deterministic per scheduled slot, so a crash
    // mid-tick + restart can't double-enqueue.
    const jobId = `auto:${row.id}:${occurrence_ts}`;
    try {
      await queue!.add(
        'run',
        { automation_id: row.id, occurrence_ts, trigger: 'cron' },
        {
          jobId,
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 200 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      );
      log.debug({ id: row.id, occurrence_ts }, 'automation.enqueued');
    } catch (err) {
      log.error(
        { id: row.id, occurrence_ts, err: (err as Error).message },
        'automation.enqueue_failed',
      );
    }
  }
}

/**
 * Manually enqueue an automation for immediate execution. Used by the
 * /run-now route. Bypasses scheduling — runs with trigger='manual'.
 */
export async function enqueueManualRun(automationId: string): Promise<void> {
  if (!queue) throw new Error('automation_dispatcher_not_started');
  const occurrence_ts = new Date().toISOString();
  const jobId = `auto:${automationId}:${occurrence_ts}`;
  await queue.add(
    'run',
    { automation_id: automationId, occurrence_ts, trigger: 'manual' },
    {
      jobId,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 200 },
      attempts: 1, // manual runs don't retry — operator sees the error directly
    },
  );
}

/**
 * Set an automation's next_run_at to the next slot of its cron+tz.
 * Called from /resume so the automation actually starts firing again.
 */
export async function scheduleNextRun(automationId: string): Promise<Date | null> {
  const { rows } = await db().query<{
    schedule_cron: string | null;
    schedule_tz: string;
  }>(
    `SELECT schedule_cron, schedule_tz FROM automations WHERE id = $1`,
    [automationId],
  );
  const r = rows[0];
  if (!r || !r.schedule_cron) return null;
  const next = nextRun(r.schedule_cron, r.schedule_tz);
  if (!next) return null;
  await db().query(
    `UPDATE automations
        SET next_run_at = $1, updated_at = now()
      WHERE id = $2`,
    [next.iso, automationId],
  );
  return next.next_run_at;
}

/** Stop the dispatcher cleanly on process shutdown. */
export async function stopAutomationDispatcher(): Promise<void> {
  if (dispatcherTimer) {
    clearInterval(dispatcherTimer);
    dispatcherTimer = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
