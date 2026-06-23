/**
 * Slack adapter — outbound for M7.2.
 *
 *   testConnect — calls auth.test with the bot token. Confirms the token
 *                 is valid + returns the workspace + bot identity.
 *   sendTest    — posts a Block Kit "Argus connection test ✓" card to
 *                 the configured default_channel (or to the bot user
 *                 itself if no channel given).
 *   send        — generic chat.postMessage helper used by the Interview
 *                 loop in M7.3.
 *
 * Inbound (signing-secret verification + events worker) lands in M7.3.
 */

export interface SlackConfig {
  team_name: string;
  default_channel?: string;
}

export interface SlackSecret {
  bot_token: string;
  signing_secret?: string;
}

export interface SlackTestResult {
  ok: boolean;
  team?: string;
  user?: string;
  bot_id?: string;
  error?: string;
}

interface AuthTestResponse {
  ok: boolean;
  team?: string;
  user?: string;
  user_id?: string;
  bot_id?: string;
  team_id?: string;
  error?: string;
}

interface PostMessageResponse {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
}

const SLACK_API = 'https://slack.com/api';

async function slackPost<T>(endpoint: string, token: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SLACK_API}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`slack ${endpoint} → http ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/**
 * `auth.test` is the canonical "is this token alive?" check.
 * Returns the bot's identity, the team it's in, and the bot_id — useful
 * later for excluding the bot's own messages from intent classification.
 */
export async function testConnect(_cfg: SlackConfig, sec: SlackSecret): Promise<SlackTestResult> {
  if (!sec.bot_token || !sec.bot_token.startsWith('xoxb-')) {
    return { ok: false, error: 'bot_token must start with xoxb- (Bot User OAuth Token)' };
  }
  try {
    const data = await slackPost<AuthTestResponse>('auth.test', sec.bot_token, {});
    if (!data.ok) return { ok: false, error: data.error ?? 'auth.test failed' };
    return {
      ok: true,
      team: data.team,
      user: data.user,
      bot_id: data.bot_id,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Post a Block-Kit "connection test" card. Used by the dashboard's
 * "Send test message" button to confirm Argus can talk to the workspace
 * end-to-end after the operator pastes their tokens.
 */
export async function sendTestMessage(
  cfg: SlackConfig,
  sec: SlackSecret,
): Promise<{ ok: boolean; ts?: string; channel?: string; error?: string }> {
  if (!sec.bot_token) return { ok: false, error: 'no_bot_token' };

  // Resolve channel: explicit default_channel wins; otherwise DM the bot user.
  let channel = cfg.default_channel?.trim();
  if (!channel) {
    // Fallback: post to the bot's own DM channel (auth.test returns bot user).
    const id = await slackPost<AuthTestResponse>('auth.test', sec.bot_token, {});
    channel = id.user_id;
    if (!channel) return { ok: false, error: 'no_default_channel_and_auth_failed' };
  }

  try {
    const res = await slackPost<PostMessageResponse>('chat.postMessage', sec.bot_token, {
      channel,
      text: 'Argus connection test ✓',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🛰️ Argus — connection test', emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Argus is connected to this workspace.*\n\nWhen the Interview loop ships (M7.3), I\'ll DM the right teammate when a chat hits a knowledge gap — and ingest their reply as a permanent Q&A.',
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Sent by Argus · ${new Date().toISOString()}` },
          ],
        },
      ],
    });
    if (!res.ok) return { ok: false, error: res.error ?? 'unknown_slack_error' };
    return { ok: true, ts: res.ts, channel: res.channel };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Generic outbound — used later by the Interview loop. Sends a message,
 * optionally as a thread reply (thread_ts) so replies route to the
 * right conversation.
 */
export async function send(
  cfg: SlackConfig,
  sec: SlackSecret,
  opts: {
    channel: string;
    text: string;
    blocks?: unknown[];
    thread_ts?: string;
  },
): Promise<{ ok: boolean; ts?: string; channel?: string; error?: string }> {
  if (!sec.bot_token) return { ok: false, error: 'no_bot_token' };
  void cfg;
  try {
    const res = await slackPost<PostMessageResponse>('chat.postMessage', sec.bot_token, {
      channel: opts.channel,
      text: opts.text,
      ...(opts.blocks ? { blocks: opts.blocks } : {}),
      ...(opts.thread_ts ? { thread_ts: opts.thread_ts } : {}),
    });
    if (!res.ok) return { ok: false, error: res.error ?? 'unknown_slack_error' };
    return { ok: true, ts: res.ts, channel: res.channel };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
