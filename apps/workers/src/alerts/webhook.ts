import { createHmac } from 'node:crypto';

/**
 * Generic HMAC-signed webhook delivery.
 *
 * Channel config:
 *   { type: 'webhook',
 *     config: { url: string, secret_env?: string, min_severity?: Severity } }
 *
 * The body is the full structured Finding as JSON. The signature header
 * follows GitHub's convention so receivers can use existing libraries:
 *
 *   X-Argus-Signature: sha256=<hex(hmac(secret, body))>
 *   X-Argus-Event: finding
 *
 * `secret_env` names an env var on the worker container that holds the
 * shared secret — secrets never live in the DB. If `secret_env` is omitted
 * the request is sent unsigned (development convenience; not recommended).
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

export async function sendWebhookAlert(
  channelConfig: Record<string, unknown>,
  finding: FindingRow,
): Promise<void> {
  const url = channelConfig['url'];
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('webhook channel has no `url` configured');
  }

  const body = JSON.stringify({
    event: 'finding',
    finding: {
      id: finding.id,
      investigator_id: finding.investigator_id,
      severity: finding.severity,
      summary: finding.summary,
      evidence: finding.evidence,
      recommendation: finding.recommendation,
      impact_estimate: finding.impact_estimate,
    },
    delivered_at: new Date().toISOString(),
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-argus-event': 'finding',
  };

  const secretEnv = channelConfig['secret_env'];
  if (typeof secretEnv === 'string' && secretEnv.length > 0) {
    const secret = process.env[secretEnv];
    if (!secret) {
      throw new Error(`webhook channel references missing env var "${secretEnv}"`);
    }
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    headers['x-argus-signature'] = `sha256=${sig}`;
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`webhook responded ${res.status}: ${await res.text()}`);
  }
}
