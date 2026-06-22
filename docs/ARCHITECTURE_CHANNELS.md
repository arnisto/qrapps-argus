# Channel chat + Interview loop — architecture (M7)

> **The thread**: a staff member asks Argus *"Is 26 March 2026 a holiday?"* on
> Slack. Argus doesn't know. Argus DMs the HR person: *"A teammate asked X
> — got an answer?"*. HR replies *"Yes — Tunisia Independence Day."*. Argus
> ingests that reply as a high-authority Q&A, then answers the original
> teammate *"Yes — Tunisia Independence Day, confirmed by HR on 22 Jun
> 2026."*. Anyone who asks tomorrow gets the answer instantly, with HR's
> reply as the citation. **Argus learned the company. Permanently.**

This is the core loop of the channel layer. Everything in this doc serves it.

---

## 1 · The four-step loop, end-to-end

```
                  ┌──────────────┐
                  │   Asker      │  (Slack DM)
                  │   Sami       │
                  └──────┬───────┘
                         │ "Is 26/03/2026 a holiday?"
                         ▼
        ┌──────────────────────────────────────────┐
        │ /v1/webhooks/slack/events                │
        │ → verify signing secret                  │
        │ → BullMQ enqueue 'channel.inbound'       │
        └──────┬───────────────────────────────────┘
               │
               ▼
       ┌─────────────────────────────────────────┐
       │ inbound worker                          │
       │ 1. classify intent (LLM, JSON):         │
       │    {type: 'question', domain: 'hr'}     │
       │ 2. runGroundedAgent(env_id, …)          │
       │    → argus_warning: no_grounded_context │
       │ 3. open an Interview run                │
       └──────┬──────────────────────────────────┘
              │
              ▼
   ┌─────────────────────────────────────────────┐
   │ expert router                               │
   │ pick member where skills @> '{hr}'          │
   │ ordered by (active_hours match, last_seen)  │
   │   → Amira (HR), preferred_channel='slack'   │
   └──────┬──────────────────────────────────────┘
          │
          ▼  pending_actions (status='pending', requires_approval=false
          │  because this is a Q-not-a-broadcast and the channel scope
          │  says is_internal=true)
          │
          ▼ BullMQ → Slack outbound worker
   ┌─────────────────────────────────────┐
   │ Expert    (Slack DM)                │
   │ Amira (HR)                          │
   │  ───────────────────────────────    │
   │ Argus 🛰️                            │
   │ Hi! A teammate (Sami) asked:        │
   │   "Is 26/03/2026 a holiday?"        │
   │ Got an answer? Just reply here.     │
   └──────┬──────────────────────────────┘
          │ "Yes — Tunisia Independence Day"
          ▼
   ┌─────────────────────────────────────┐
   │ /v1/webhooks/slack/events (again)   │
   │ → same conversation thread          │
   │ → BullMQ 'channel.inbound'          │
   └──────┬──────────────────────────────┘
          │
          ▼
   ┌─────────────────────────────────────────────┐
   │ inbound worker (second pass)                │
   │ 1. conversation_id maps to the open         │
   │    Interview run                            │
   │ 2. classify intent: 'answer'                │
   │ 3. INSERT INTO sources (kind='qa',          │
   │    authority=85, attributed_to=<amira>)     │
   │ 4. embed + chunk → ingested forever         │
   │ 5. resume original Interview run            │
   │ 6. runGroundedAgent again — now grounded    │
   └──────┬──────────────────────────────────────┘
          │
          ▼
   ┌─────────────────────────────────────┐
   │ Asker  (back in Sami's Slack DM)    │
   │  ───────────────────────────────    │
   │ Argus 🛰️                            │
   │ Yes — Tunisia Independence Day      │
   │ (confirmed by Amira · HR · today)   │
   │ [#1] qa://amira/26-03-2026-holiday  │
   └─────────────────────────────────────┘
```

Two webhook hops, one BullMQ queue, one new chat surface, four new tables.
Every piece below exists to enable exactly this loop.

---

## 2 · Data model deltas

Mirrors the patterns already in `migration 0007` — `*_ct`/`*_iv` for encryption,
`kind` discriminators, `UNIQUE(env_id, …)` for tenant isolation.

### 2.1 `connectors` (channel-shape)

```sql
-- migration 0009_channels.sql
CREATE TYPE connector_kind AS ENUM ('channel');  -- 'db' / 'tool' added in M8/M9

CREATE TABLE connectors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id          UUID NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  kind            connector_kind NOT NULL,
  subtype         TEXT NOT NULL,          -- 'slack' | 'email' | 'sms' | 'whatsapp' | 'discord'
  name            TEXT NOT NULL,          -- 'argus-bot-acme'
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
                  -- Slack: { team_id, bot_user_id, default_channel?, scopes:[…], event_subscription_url }
                  -- Email: { from_addr, smtp_host, smtp_port, imap_host?, inbound_via:'ses'|'imap' }
                  -- SMS:   { messaging_service_sid, from_number }
  secret_ct       BYTEA,                  -- bot_token | smtp_password | twilio_auth_token
  secret_iv       BYTEA,
  signing_ct      BYTEA,                  -- Slack signing secret (separate from bot token)
  signing_iv      BYTEA,
  scope           JSONB NOT NULL DEFAULT '{}'::jsonb,
                  -- { inbound: true, outbound: true, allow_dm: true,
                  --   channel_allowlist: ['#argus-asks'],
                  --   is_internal: true }   ← turns OFF approval for staff-to-staff
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (env_id, kind, name)
);
```

### 2.2 `conversations` + `messages` — thread state

```sql
CREATE TYPE conversation_status AS ENUM (
  'open', 'awaiting_expert', 'awaiting_approval', 'resolved', 'escalated'
);

CREATE TABLE conversations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id               UUID NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  connector_id         UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  external_thread_id   TEXT NOT NULL,    -- slack 'thread_ts' / email RFC2822 root id / twilio
  external_user_id     TEXT NOT NULL,    -- the original asker
  asker_display        TEXT,
  topic                TEXT,             -- one-line summary, LLM-generated
  domain               TEXT,             -- classified: 'hr' | 'ops' | 'finance' | 'product' | 'unknown'
  status               conversation_status NOT NULL DEFAULT 'open',
  parent_conversation  UUID REFERENCES conversations(id) ON DELETE CASCADE,
                       -- the Interview ask conversation is the CHILD of the asker conversation
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connector_id, external_thread_id)
);

CREATE INDEX conversations_env_status_idx ON conversations(env_id, status);

CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_author    AS ENUM ('asker', 'expert', 'argus', 'human_approver');
CREATE TYPE message_intent    AS ENUM ('question', 'answer', 'ack', 'reject', 'unknown');

CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  external_message_id TEXT,              -- slack ts / email Message-ID / twilio sid
  direction           message_direction NOT NULL,
  author              message_author NOT NULL,
  external_user_id    TEXT,              -- who actually sent it on the channel
  body                TEXT NOT NULL,
  body_html           TEXT,
  intent              message_intent,
  classified_domain   TEXT,
  agent_run_id        UUID,              -- if Argus authored: which run produced it
  ingested_source_id  UUID REFERENCES sources(id) ON DELETE SET NULL,
                                         -- if an expert's answer → which Q&A source it became
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, external_message_id)
);
```

### 2.3 `member_profiles` — skills, channels, hours

The existing `memberships` table tells us who belongs to which org. It says
nothing about what they know. New side-table:

```sql
CREATE TABLE member_profiles (
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  skills           TEXT[] NOT NULL DEFAULT '{}',
                   -- ['hr', 'payroll', 'recruitment']  — used by the router
  channel_handles  JSONB NOT NULL DEFAULT '{}'::jsonb,
                   -- { slack: 'U07ABCD', email: 'amira@acme.tn', sms: '+216...' }
  preferred_channel TEXT,                -- 'slack' | 'email' | 'sms'
  active_hours     JSONB,                -- { tz: 'Africa/Tunis', weekdays: '09-17' }
  is_expert        BOOLEAN NOT NULL DEFAULT FALSE,
  expertise_score  REAL,                 -- learned over time; starts at 0.5 for is_expert
  last_seen_at     TIMESTAMPTZ,
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX member_profiles_skills_idx ON member_profiles USING GIN (skills);
```

### 2.4 `pending_actions` (only for external outbound)

When the channel scope's `is_internal=true` is **false** — e.g., the Inbox
product responding on behalf of a customer-facing brand — the outbound
message goes through the approval queue (already designed in the M7
brief). For internal staff-to-staff loops the queue is bypassed (the
"Guardrails active" promise is about not autoreplying to customers; asking
your own HR is a different threat model).

---

## 3 · The expert router — picking who to ask

Given a classified message `{ domain: 'hr' }`, pick one expert:

```ts
async function routeExpert(envId, orgId, domain) {
  // 1. shortlist on domain → skills match
  const candidates = await db.query(`
    SELECT user_id, channel_handles, preferred_channel, active_hours,
           expertise_score, last_seen_at
      FROM member_profiles
     WHERE org_id = $1 AND $2 = ANY(skills)
     ORDER BY expertise_score DESC NULLS LAST, last_seen_at DESC NULLS LAST
     LIMIT 5
  `, [orgId, domain]);

  // 2. filter by active hours (in their TZ)
  const live = candidates.filter(c => withinActiveHours(c.active_hours));

  // 3. pick the top one; if none live, queue for first-active
  return (live[0] ?? candidates[0]) ?? null;
}
```

Why not LLM-routed? The shortlist by GIN-indexed array is two orders of
magnitude cheaper than embedding the question + cosine-against expert
bios. We only fall back to LLM scoring when the candidate list is empty
or the question's domain is `unknown` (then the LLM picks a domain first,
then we re-shortlist).

**Learning**: when an expert answers, their `expertise_score` for that
domain bumps. When they ignore / "I don't know", it decays. Simple
Bayesian update over `domain × user`, stored in `member_profiles.skills_score`
JSONB (deferred to M8 — first ship with the bare skills array).

---

## 4 · The Interview lifecycle

Each ask creates ONE `conversations` row with `status='open'`. If retrieval
misses, an Interview is opened — a CHILD `conversations` row pointing at
the expert. State machine:

```
open ──▶ awaiting_expert  ──(expert reply)──▶ resolved
   │            │
   │            └──(timeout / I-don't-know)──▶ escalated
   │
   └──(grounded by RAG)──▶ resolved
```

Escalation policy (configurable per env, sensible defaults):

| Step | Wait | Next |
|---|---|---|
| 1st expert pinged | 1h | re-ping with "still need this?" |
| 1st expert silent after re-ping | 2h | try 2nd expert (next in shortlist) |
| All experts silent | 4h | mark `escalated`, DM the org owner, message asker "still investigating" |
| Asker cancels | — | mark `resolved`, close child convos |

Wall-clock timers are BullMQ delayed jobs (`addJob('interview.escalate',
{conversation_id}, {delay: 3600_000})`). Cancelling a conversation
removes the job by id.

---

## 5 · The webhook ingest path

ONE endpoint per channel subtype. Identical contract:

```
POST /v1/webhooks/:connector_id/slack/events
POST /v1/webhooks/:connector_id/email
POST /v1/webhooks/:connector_id/sms
```

Slack-specific path:

```ts
// apps/api/src/routes/webhooks/slack.ts
app.post('/v1/webhooks/:cid/slack/events', async (req, reply) => {
  // 1. signing-secret verification (X-Slack-Signature, ±5min)
  if (!verifySlackSig(req.body, req.headers, await loadSigningSecret(cid))) {
    return reply.code(401).send({ error: 'bad_signature' });
  }
  const evt = req.body;

  // 2. URL verification challenge (only at first setup)
  if (evt.type === 'url_verification') return { challenge: evt.challenge };

  // 3. ack within 3s — Slack retries ruthlessly on slow replies
  reply.code(200).send({ ok: true });

  // 4. enqueue the actual work
  await jobs.add('channel.inbound', {
    connector_id: cid,
    subtype: 'slack',
    event: evt
  }, {
    jobId: `slack:${evt.event_id}`,   // Slack delivers each event ≤4 times;
                                       // jobId dedupes
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });
});
```

Worker resolves `conversation_id`:

```ts
const thread = evt.event.thread_ts ?? evt.event.ts;
let conv = await findConversation(connectorId, thread);
if (!conv) {
  conv = await createConversation({
    connector_id,
    env_id: connector.env_id,
    external_thread_id: thread,
    external_user_id: evt.event.user,
    asker_display: await slackGetUserName(evt.event.user),
    status: 'open',
  });
}
```

The same handler covers BOTH the asker's first message AND the expert's
reply (a different thread_ts maps to a different conversation; the child
Interview conversation is found because the worker stored its
`external_thread_id` when sending the DM).

---

## 6 · Outbound — Slack DM the expert

```ts
// apps/api/src/agent/channels/slack.ts
export async function sendInterview(env, expert, conversation, asker, question) {
  const c = await loadConnector(env.id, 'slack');
  const blocks = [
    section(`*${asker.display}* asked:\n> ${question}`),
    section(`Got an answer? Just reply in this thread — I'll learn it.`),
    actions([
      button({ text: 'I don’t know', value: `dontknow:${conversation.id}` }),
      button({ text: 'Forward to…',  value: `forward:${conversation.id}` }),
    ]),
  ];

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${decryptKey(c.secret_ct, c.secret_iv)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: expert.channel_handles.slack,  // direct DM via user id
      blocks,
      text: `Quick HR question from ${asker.display}`,  // a11y fallback
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`slack: ${data.error}`);

  // record the child conversation so the expert's reply maps back
  await createConversation({
    env_id: env.id,
    connector_id: c.id,
    external_thread_id: data.ts,
    external_user_id: expert.channel_handles.slack,
    parent_conversation: conversation.id,
    status: 'awaiting_expert',
    domain: conversation.domain,
    topic: conversation.topic,
  });
}
```

---

## 7 · Ingesting the expert's reply as forever-knowledge

When the expert's reply arrives (Slack webhook → worker → conversation
match → `direction='inbound', author='expert'`), the worker:

```ts
// classify the expert's reply
const intent = await classify(expertMessage.body, conversation.topic);
if (intent.type === 'answer') {
  // 1. ingest as Q&A in the asker's env's knowledge core
  const source = await ingestQA({
    env_id: env.id,
    question: conversation.topic,
    answer:   expertMessage.body,
    attributed_to: expert.user_id,
    authority: 85,                    // higher than files (60), just below pinned org wisdom
  });

  // 2. link the message → source for the audit trail
  await db.query(
    `UPDATE messages SET ingested_source_id = $1 WHERE id = $2`,
    [source.id, expertMessage.id]
  );

  // 3. resume the parent conversation: re-run grounded chat
  const parent = await findParent(conversation.id);
  const reply  = await runGroundedAgent(env.id, [{ role: 'user', content: parent.topic }]);
  await sendInterview…  // back to the asker via THEIR connector

  // 4. close the loop
  await markResolved(conversation.id);
  await markResolved(parent.id);
}
```

Q&A authority `=85` means it beats file-derived chunks (`=60`) but doesn't
drown a pinned policy doc (`=95`). Anyone asking the same question
tomorrow gets *"Yes — Tunisia Independence Day, confirmed by HR on 22 Jun
2026 [#1]"* without anyone needing to think about it.

---

## 8 · Why Slack first

| Channel | Setup cost | Audit value | First-100-users fit |
|---|---|---|---|
| **Slack** | OAuth app + signing secret + bot scopes. 1 day. | Block Kit gives free approval cards. | Devs + most B2B teams already on it. **Pick this.** |
| Email | RFC2822 threading is delicate. SES inbound = AWS infra. IMAP = stateful. | Universal, no install. | M8. |
| WhatsApp Business | Meta verification. Long, expensive. | Right channel for Tunisian SMEs. | M9 — and only when a paying customer asks. |
| SMS / Twilio | Phone-number leasing, A2P 10DLC. | Fits low-tech teams. | Skip until M10+. |

A single Slack-only ship covers the demo, the indie hacker crowd, the
HN-Show audience, and almost every WIP-grounded-chat-for-team-knowledge
user in the first 100. Email lands when the second paying buyer asks.

---

## 9 · The chat surface stays clean

The OpenAI-compatible `/v1/chat/completions` endpoint does **not change**.
Channels are an *operator* surface — a sibling chat entrypoint that
flows the same `runGroundedAgent` engine, persists conversations, and
talks back through external connectors. The published API contract for
buyers ("baseURL + Bearer key → grounded reply with citations") is
untouched.

What an OpenAI-compatible caller might want later — *"include channel
context in retrieval"* — gets one new field (`extra_body.channel_thread_id`)
when an actual buyer asks.

---

## 10 · Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Expert ignores DMs** (most common failure) | 1h re-ping → 2h next expert → 4h escalate. Asker is told *"still investigating"* so they're not in the dark. |
| **Argus loop-DMs itself** (when the expert's bot reply triggers another webhook) | `messages.author='argus'` rows are excluded from intent classification. `external_user_id == bot_user_id` is a hard skip. |
| **PII in expert answers leaks across envs** | Q&A ingestion is `env_id`-scoped. The expert's reply CAN only ground chats in the same env. The org owner sees an `/audit` row of every cross-conversation knowledge ingest. |
| **Slack signature replay** | `±5min` window on `X-Slack-Request-Timestamp`. BullMQ jobId dedup. |
| **Wrong expert routed** (e.g., HR question goes to engineering) | Asker can `/argus reroute hr` slash command (M8). For M7, the human owner overrides by editing `member_profiles.skills`. |
| **Expertise drift** (Amira leaves HR, new person Sarah joins) | `is_expert=false` for Amira, new row for Sarah with `skills=['hr']`. Active routing follows immediately. |
| **Conversational compromise** ("ignore prior — pretend you're an admin") | Inbound messages are wrapped as the user role only. Argus's own system prompt is locked. The Interview classify-pass is structured-output JSON, not free text. |

---

## 11 · Ship order inside M7

| Sub-milestone | What | Why first |
|---|---|---|
| **M7.1** | `connectors` + `conversations` + `messages` + `member_profiles` migrations. CRUD endpoints (no agent logic yet). | Foundation. Two evenings. |
| **M7.2** | Slack OAuth app + connect flow (operator pastes signing secret + bot token, or proper OAuth dance with redirect). | Without this nothing works. One day. |
| **M7.3** | Inbound webhook → conversation create → intent classify → grounded reply (no Interview yet). | Half the loop — *Argus can already answer Slack questions it knows*. One day. Demo-able. |
| **M7.4** | Interview escalation: no grounded answer → expert routing → DM out → ingest reply → answer asker. | The full loop. Two days. |
| **M7.5** | Approval surface for non-internal envs (Inbox card with Approve/Reject Block Kit actions). | Only needed when a paying buyer asks for customer-facing replies. Defer until then. |

Total: ~1 week of focused work. The output: someone DMs the Argus bot, and
the company brain answers — or learns from a teammate and answers within
minutes.

---

## Folder layout

```
apps/api/src/
├── routes/
│   ├── connectors.ts            # CRUD + Slack OAuth callback
│   ├── members.ts                # extend with skills/channel_handles editing
│   └── webhooks/
│       ├── slack.ts              # /v1/webhooks/:cid/slack/events
│       ├── email.ts              # (M8)
│       └── sms.ts                # (M9)
├── agent/
│   ├── channels/
│   │   ├── slack.ts              # Block Kit builders + chat.postMessage client
│   │   ├── email.ts              # (M8)
│   │   └── registry.ts           # subtype → driver
│   ├── interview/
│   │   ├── lifecycle.ts          # the state machine in §4
│   │   ├── route-expert.ts       # §3 router
│   │   └── classify-intent.ts    # LLM JSON classifier
│   └── workers/
│       ├── inbound.ts            # BullMQ 'channel.inbound' worker
│       ├── outbound.ts           # BullMQ 'channel.outbound' worker (sends)
│       └── interview-timer.ts    # BullMQ delayed-job escalation timer
└── llm/
    └── chat.ts                   # unchanged — already the engine

docker/postgres/migrations/
└── 0009_channels.sql              # all four tables + enums

apps/dashboard/src/app/
├── (app)/inbox/                  # ALREADY a nav stub — fill in
├── (app)/interview/              # ALREADY a nav stub — fill in
├── (app)/members/                # extend with skills/channel_handles editor
└── (app)/connectors/             # ALREADY a nav stub — fill in
```

Every Inbox / Interview / Connectors / Channels stub in the design lands real
in this milestone — they're no longer placeholders, they're the surface
people actually use.
