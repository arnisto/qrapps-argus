import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { loadConfig } from '@argus/shared';
import { QUEUES } from '@argus/events';
import { db } from '../db.js';

/**
 * Single aggregating endpoint that powers the dashboard "System Health" page.
 * Hits Postgres + Redis in parallel; everything is bounded so the page renders
 * fast even on a noisy stack.
 *
 * The existing /healthz (liveness) and /readyz (DB reachability) stay as the
 * cheap container-healthcheck endpoints — this is the deep view.
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  app.get('/readyz', async () => {
    await db().query('SELECT 1');
    return { status: 'ready' };
  });

  app.get('/v1/health/snapshot', async () => {
    const [
      queues,
      activity,
      topInvs,
      topAgents,
      recentFailures,
      repetitive,
      connectors,
      channels,
      severityBreakdown,
      alertsBacklog,
      runningInvs,
    ] = await Promise.all([
      queueDepths(),
      activitySummary(),
      topFailingInvestigators(),
      topFailingAgents(),
      recentInvestigationFailures(),
      repetitiveFindings(),
      connectorStatus(),
      channelStatus(),
      severityBreakdown24h(),
      pendingAlertBacklog(),
      currentlyRunning(),
    ]);

    return {
      generated_at: new Date().toISOString(),
      queues,
      activity,
      currently_running: runningInvs,
      top_failing_investigators: topInvs,
      top_failing_agents: topAgents,
      recent_failures: recentFailures,
      repetitive_findings: repetitive,
      connectors,
      channels,
      severity_breakdown_24h: severityBreakdown,
      alerts_backlog: alertsBacklog,
    };
  });
}

// ---------------------------------------------------------------------------
// Subqueries — each is intentionally small + indexed.
// ---------------------------------------------------------------------------

async function queueDepths() {
  // Reuses the same Redis URL the app is configured with. Connection is opened
  // per-request — cheap, and avoids long-lived state from a request-scoped
  // endpoint. Same idea as apps/workers/scripts/queues-inspect.ts.
  const conn = new IORedis(loadConfig().redisUrl, { maxRetriesPerRequest: null });
  try {
    const result: Record<string, unknown> = {};
    for (const name of Object.values(QUEUES)) {
      const q = new Queue(name, { connection: conn });
      try {
        result[name] = await q.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
        );
      } finally {
        await q.close();
      }
    }
    return result;
  } finally {
    await conn.quit().catch(() => undefined);
  }
}

async function activitySummary() {
  const r = await db().query<{
    events_24h: string;
    investigations_24h: string;
    investigations_succeeded_24h: string;
    investigations_failed_24h: string;
    findings_24h: string;
  }>(`
    SELECT
      (SELECT count(*) FROM events WHERE ingested_at >= now() - interval '24 hours')::text AS events_24h,
      (SELECT count(*) FROM investigations WHERE started_at >= now() - interval '24 hours')::text AS investigations_24h,
      (SELECT count(*) FROM investigations WHERE started_at >= now() - interval '24 hours' AND status = 'succeeded')::text AS investigations_succeeded_24h,
      (SELECT count(*) FROM investigations WHERE started_at >= now() - interval '24 hours' AND status = 'failed')::text AS investigations_failed_24h,
      (SELECT count(*) FROM findings WHERE created_at >= now() - interval '24 hours')::text AS findings_24h
  `);
  return r.rows[0];
}

async function topFailingInvestigators() {
  const r = await db().query<{
    investigator_id: string;
    name: string | null;
    fails: number;
    runs: number;
    fail_rate: number;
  }>(`
    SELECT
      i.investigator_id,
      inv.name,
      count(*) FILTER (WHERE i.status = 'failed')::int AS fails,
      count(*)::int AS runs,
      ROUND(
        100.0 * count(*) FILTER (WHERE i.status = 'failed')::numeric / NULLIF(count(*), 0),
        1
      )::float AS fail_rate
    FROM investigations i
    LEFT JOIN investigators inv ON inv.id = i.investigator_id
    WHERE i.started_at >= now() - interval '24 hours'
    GROUP BY i.investigator_id, inv.name
    HAVING count(*) FILTER (WHERE i.status = 'failed') > 0
    ORDER BY fails DESC, fail_rate DESC
    LIMIT 5
  `);
  return r.rows;
}

async function topFailingAgents() {
  const r = await db().query<{
    agent_id: string;
    agent_name: string | null;
    fails: number;
    last_error: string | null;
  }>(`
    SELECT
      ar.agent_id,
      a.name AS agent_name,
      count(*) FILTER (WHERE ar.status = 'failed')::int AS fails,
      (array_agg(ar.error ORDER BY ar.started_at DESC) FILTER (WHERE ar.status = 'failed'))[1] AS last_error
    FROM agent_runs ar
    LEFT JOIN agents a ON a.id = ar.agent_id
    WHERE ar.started_at >= now() - interval '24 hours'
      AND ar.status = 'failed'
    GROUP BY ar.agent_id, a.name
    ORDER BY fails DESC
    LIMIT 5
  `);
  // Truncate long error messages so the dashboard payload stays small.
  return r.rows.map((r) => ({
    ...r,
    last_error: r.last_error ? r.last_error.slice(0, 200) : null,
  }));
}

async function recentInvestigationFailures() {
  const r = await db().query(
    `SELECT id, investigator_id, started_at, finished_at,
            LEFT(coalesce(error, ''), 200) AS error
     FROM investigations
     WHERE status = 'failed'
       AND started_at >= now() - interval '24 hours'
     ORDER BY started_at DESC
     LIMIT 8`,
  );
  return r.rows;
}

/**
 * Repetitive-finding detection: same investigator emitting findings whose
 * `summary` matches on the first 60 chars within the last 6 hours. Cheap
 * heuristic — no vector embeddings — and surfaces flapping/duplicate alerts.
 */
async function repetitiveFindings() {
  const r = await db().query<{
    investigator_id: string;
    summary_prefix: string;
    occurrences: number;
    last_seen: string;
  }>(`
    SELECT
      investigator_id,
      LEFT(summary, 60) AS summary_prefix,
      count(*)::int AS occurrences,
      max(created_at) AS last_seen
    FROM findings
    WHERE created_at >= now() - interval '6 hours'
    GROUP BY investigator_id, LEFT(summary, 60)
    HAVING count(*) >= 2
    ORDER BY occurrences DESC, last_seen DESC
    LIMIT 5
  `);
  return r.rows;
}

async function connectorStatus() {
  const r = await db().query(
    `SELECT id, name, type, enabled, last_sync_at,
            LEFT(coalesce(last_error, ''), 200) AS last_error,
            last_test_at, last_test_ok,
            LEFT(coalesce(last_test_error, ''), 200) AS last_test_error
     FROM connectors
     ORDER BY name ASC`,
  );
  return r.rows;
}

async function channelStatus() {
  const r = await db().query<{
    channel_id: string;
    name: string;
    type: string;
    enabled: boolean;
    min_severity: string | null;
    sent_24h: number;
    failed_24h: number;
  }>(`
    SELECT
      c.id AS channel_id,
      c.name,
      c.type,
      c.enabled,
      c.config->>'min_severity' AS min_severity,
      count(a.id) FILTER (WHERE a.status = 'sent' AND a.created_at >= now() - interval '24 hours')::int AS sent_24h,
      count(a.id) FILTER (WHERE a.status = 'failed' AND a.created_at >= now() - interval '24 hours')::int AS failed_24h
    FROM alert_channels c
    LEFT JOIN alerts a ON a.channel_id = c.id
    GROUP BY c.id, c.name, c.type, c.enabled, c.config
    ORDER BY c.name ASC
  `);
  return r.rows;
}

async function severityBreakdown24h() {
  const r = await db().query<{ severity: string; n: number }>(
    `SELECT severity, count(*)::int AS n
     FROM findings
     WHERE created_at >= now() - interval '24 hours'
     GROUP BY severity
     ORDER BY array_position(ARRAY['critical','high','medium','low','none'], severity)`,
  );
  return r.rows;
}

async function pendingAlertBacklog() {
  const r = await db().query<{ pending: number; failed: number; oldest_pending_age_s: number | null }>(
    `SELECT
       count(*) FILTER (WHERE status = 'pending')::int AS pending,
       count(*) FILTER (WHERE status = 'failed' AND attempts >= 3)::int AS failed,
       EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status = 'pending')))::int AS oldest_pending_age_s
     FROM alerts
     WHERE created_at >= now() - interval '24 hours'`,
  );
  return r.rows[0];
}

async function currentlyRunning() {
  const r = await db().query<{
    id: string;
    investigator_id: string;
    started_at: string;
    age_s: number;
  }>(
    `SELECT id, investigator_id, started_at,
            EXTRACT(EPOCH FROM (now() - started_at))::int AS age_s
     FROM investigations
     WHERE status = 'running'
     ORDER BY started_at ASC
     LIMIT 10`,
  );
  return r.rows;
}
