import { Worker } from 'bullmq';
import { childLogger, meetsThreshold, type Severity } from '@argus/shared';
import { QUEUES } from '@argus/events';
import { redis } from '../connection.js';
import { db } from '../db.js';
import { sendSlackAlert } from '../alerts/slack.js';
import { sendDiscordAlert } from '../alerts/discord.js';
import { sendWebhookAlert } from '../alerts/webhook.js';

interface DispatchJob {
  finding_id: string;
  channel_id: string;
}

/**
 * Pull an alert from the queue, look up the channel + finding, apply the
 * per-channel `min_severity` gate, dispatch via the type-specific adapter,
 * and record the outcome in the `alerts` row.
 *
 * Supported channel types:
 *   slack    — incoming webhook (mrkdwn body)
 *   discord  — incoming webhook (embeds body)
 *   webhook  — generic JSON POST with optional HMAC-SHA256 signature header
 */
export async function startAlertWorker(): Promise<() => Promise<void>> {
  const log = childLogger({ component: 'workers.alert-dispatch' });

  const worker = new Worker<DispatchJob>(
    QUEUES.alertsDispatch,
    async (job) => {
      const { finding_id, channel_id } = job.data;

      const channelRow = await db().query<{
        type: string;
        config: Record<string, unknown>;
        enabled: boolean;
      }>(`SELECT type, config, enabled FROM alert_channels WHERE id = $1`, [channel_id]);
      if (channelRow.rowCount === 0 || !channelRow.rows[0]!.enabled) {
        log.warn({ channel_id }, 'alert.channel.missing_or_disabled');
        return;
      }
      const channel = channelRow.rows[0]!;

      const findingRow = await db().query(
        `SELECT id, investigator_id, severity, summary, evidence, recommendation, impact_estimate
         FROM findings WHERE id = $1`,
        [finding_id],
      );
      if (findingRow.rowCount === 0) {
        log.warn({ finding_id }, 'alert.finding.missing');
        return;
      }
      const finding = findingRow.rows[0]!;

      // Per-channel severity gate. Skip silently (no `alerts` row written) so
      // recurring sub-threshold findings don't pollute the alerts log.
      const channelMin = (channel.config['min_severity'] as Severity | undefined) ?? 'low';
      if (!meetsThreshold(finding.severity as Severity, channelMin)) {
        log.debug(
          { channel_id, finding_id, severity: finding.severity, threshold: channelMin },
          'alert.skipped.below_threshold',
        );
        return;
      }

      const alert = await db().query<{ id: string }>(
        `INSERT INTO alerts (finding_id, channel_id, status, attempts)
         VALUES ($1, $2, 'pending', 0)
         RETURNING id`,
        [finding_id, channel_id],
      );
      const alertId = alert.rows[0]!.id;

      try {
        await dispatch(channel.type, channel.config, finding);
        await db().query(
          `UPDATE alerts SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`,
          [alertId],
        );
      } catch (err) {
        await db().query(
          `UPDATE alerts SET status = 'failed', last_error = $2, attempts = attempts + 1 WHERE id = $1`,
          [alertId, (err as Error).message],
        );
        throw err;
      }
    },
    { connection: redis(), concurrency: 4 },
  );

  worker.on('failed', (job, err) =>
    log.error({ err, jobId: job?.id, data: job?.data }, 'alert.dispatch.failed'),
  );

  return async () => {
    await worker.close();
  };
}

/**
 * Single dispatch point per channel type. Adding a channel type is now a
 * one-line addition here plus a new sender module under `../alerts/`.
 */
async function dispatch(
  type: string,
  config: Record<string, unknown>,
  finding: Parameters<typeof sendSlackAlert>[1],
): Promise<void> {
  switch (type) {
    case 'slack':
      return sendSlackAlert(config, finding);
    case 'discord':
      return sendDiscordAlert(config, finding);
    case 'webhook':
      return sendWebhookAlert(config, finding);
    default:
      throw new Error(`alert channel type "${type}" is not supported`);
  }
}
