import { loadConfig } from '@argus/shared';

interface FindingRow {
  id: string;
  investigator_id: string;
  severity: string;
  summary: string;
  evidence: Array<{ event_id: string; reason: string }>;
  recommendation: string | null;
  impact_estimate: { currency: string; amount: number; basis: string } | null;
}

const EMOJI: Record<string, string> = {
  critical: ':rotating_light:',
  high: ':warning:',
  medium: ':eyes:',
  low: ':information_source:',
  none: ':white_check_mark:',
};

/**
 * Slack incoming-webhook delivery. Resolves the URL from either an explicit
 * `webhook_url` in the channel config or `webhook_url_env` pointing to an
 * env var (the default 'slack:ops' channel uses the latter).
 */
export async function sendSlackAlert(
  channelConfig: Record<string, unknown>,
  finding: FindingRow,
): Promise<void> {
  const webhookUrl =
    (typeof channelConfig['webhook_url'] === 'string' && (channelConfig['webhook_url'] as string)) ||
    (typeof channelConfig['webhook_url_env'] === 'string'
      ? process.env[channelConfig['webhook_url_env'] as string] ?? loadConfig().slackWebhookUrl
      : null);

  if (!webhookUrl) throw new Error('slack channel has no webhook_url configured');

  const emoji = EMOJI[finding.severity] ?? ':grey_question:';
  const impact =
    finding.impact_estimate
      ? `\n*Estimated impact:* ${finding.impact_estimate.amount} ${finding.impact_estimate.currency} — ${finding.impact_estimate.basis}`
      : '';
  const evidence =
    finding.evidence.length > 0
      ? `\n*Evidence:* ${finding.evidence.length} event(s): ` +
        finding.evidence
          .slice(0, 5)
          .map((e) => `\`${e.event_id}\``)
          .join(', ') +
        (finding.evidence.length > 5 ? `, …(+${finding.evidence.length - 5} more)` : '')
      : '';
  const recommendation = finding.recommendation ? `\n*Recommendation:* ${finding.recommendation}` : '';

  const text = `${emoji} *Argus — ${finding.investigator_id}* (severity: \`${finding.severity}\`)\n${finding.summary}${impact}${evidence}${recommendation}`;

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`slack webhook responded ${res.status}: ${await res.text()}`);
  }
}
