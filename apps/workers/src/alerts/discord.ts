/**
 * Discord incoming-webhook delivery.
 *
 * Channel config:
 *   { type: 'discord',
 *     config: { webhook_url?: string, webhook_url_env?: string, min_severity?: Severity } }
 *
 * Mirrors the Slack dispatcher's resolve pattern: prefer `webhook_url`, fall
 * back to reading from an env var named in `webhook_url_env`. Stored channel
 * rows should use `webhook_url_env` so secrets stay out of the DB.
 */
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
  critical: '🚨',
  high: '⚠️',
  medium: '👀',
  low: 'ℹ️',
  none: '✅',
};

const COLOR: Record<string, number> = {
  critical: 0xdc2626,
  high: 0xea580c,
  medium: 0xd97706,
  low: 0x0284c7,
  none: 0x64748b,
};

export async function sendDiscordAlert(
  channelConfig: Record<string, unknown>,
  finding: FindingRow,
): Promise<void> {
  const webhookUrl = resolveWebhookUrl(channelConfig);
  if (!webhookUrl) throw new Error('discord channel has no webhook_url configured');

  const emoji = EMOJI[finding.severity] ?? '❔';
  const color = COLOR[finding.severity] ?? 0x64748b;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (finding.impact_estimate) {
    fields.push({
      name: 'Estimated impact',
      value: `${finding.impact_estimate.amount.toLocaleString()} ${finding.impact_estimate.currency} — ${finding.impact_estimate.basis}`.slice(0, 1024),
    });
  }
  if (finding.evidence.length > 0) {
    const cited = finding.evidence
      .slice(0, 8)
      .map((e) => `\`${e.event_id}\``)
      .join(', ');
    const tail = finding.evidence.length > 8 ? ` … +${finding.evidence.length - 8} more` : '';
    fields.push({ name: `Evidence (${finding.evidence.length})`, value: (cited + tail).slice(0, 1024) });
  }
  if (finding.recommendation) {
    fields.push({ name: 'Recommendation', value: finding.recommendation.slice(0, 1024) });
  }

  const embed = {
    title: `${emoji} ${finding.investigator_id}`,
    description: finding.summary.slice(0, 4000),
    color,
    fields,
    footer: { text: `Argus · severity ${finding.severity}` },
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) {
    throw new Error(`discord webhook responded ${res.status}: ${await res.text()}`);
  }
}

function resolveWebhookUrl(channelConfig: Record<string, unknown>): string | null {
  const direct = channelConfig['webhook_url'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const envName = channelConfig['webhook_url_env'];
  if (typeof envName === 'string' && envName.length > 0) {
    return process.env[envName] ?? null;
  }
  return null;
}
