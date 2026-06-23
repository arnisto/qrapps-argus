# Automations — architecture (M8)

> **The product loop**: every Monday at 09:00 Tunis time, Argus pulls last
> week's order totals from the `acme-prod` Postgres connector, summarises
> the trends in plain English with grounded citations to the queried rows,
> and posts the summary to Slack `#leadership`. The operator wrote this
> as one English sentence. Argus compiled it once into a structured plan
> at save time. From then on it runs forever on its schedule — predictably,
> auditably, with per-run cost caps and a 30-day visual heatmap of every
> execution.

This doc codifies the M8 design. Two independent advisors (software-architect
and ux-lead) reviewed the proposal and agreed on every load-bearing
decision below. Their critiques are folded in.

---

## 1 · The four hard decisions

### 1.1 Compile at save, generate at run

The natural-language prompt is **read once**, at save time, by an LLM that
emits a structured JSON plan: which connector reads, which channel sends,
what the SQL template looks like, what model summarises. The plan is
**frozen** in `automations.compiled_plan` JSONB. From then on, runs do
NOT re-plan.

What re-generates each run is the **content**:
- The SQL gets executed against the live DB → fresh rows
- The summarisation prompt gets fed those fresh rows → fresh text
- That text gets posted to Slack

Why this matters: at 1000+ automations running daily, re-planning is
both wasteful ($) and dangerous (the LLM might drift the plan
non-deterministically, sending tomorrow's report to the wrong channel).
**The schedule is the one thing that must be predictable.**

Re-planning happens only on explicit operator action: clicking
*"Recompile"* in the edit drawer, or editing the prompt text + clicking
*Save*. Re-planning on schema drift is M8.3+.

### 1.2 The SEND is not an LLM tool

`runGroundedChat()` (M5 + M7.4) is the **read** engine. It has `db.query`
as a tool today. **It will never get `slack.send` as a tool.**

Why: any LLM tool can be invoked by the LLM. If `slack.send` were a tool,
a malicious row pulled from a customer's DB could exfiltrate to an
attacker's Slack via prompt injection. By keeping the send as a
**declarative final step** the runner executes outside the LLM loop, the
worst a poisoned input can do is corrupt the *content* of the summary.
The destination is fixed by the compiled plan.

This also keeps `POST /v1/chat/completions` clean: a buyer using Argus
as a RAG layer cannot accidentally cause Slack posts.

### 1.3 Postgres = schedule truth, BullMQ = execution

A scheduled automation has two pieces of state:
- **When it should next run** — lives in `automations.next_run_at`
  (Postgres). Queryable, editable, atomically advanceable via CAS.
- **The current execution** — lives in BullMQ (Redis). Owned by the
  worker process, retries, dead-letters.

At scale (1000+ automations × 100 envs = 100k scheduled tasks), putting
each as a BullMQ repeatable job would dominate the Redis keyspace and
make the schedules unqueryable. Instead: **one** BullMQ repeatable job —
the dispatcher — runs every 5 seconds and queries Postgres for
`next_run_at < now() AND status='active' LIMIT 500`. For each due row,
it CAS-advances `next_run_at` and enqueues a one-off run job with
`jobId = auto:<id>:<occurrence_ts>` (idempotent across crashes).

Trade-off: 5s minimum cron resolution. Acceptable — the user's example
is *"Monday 9am"*, not *"every 200ms"*.

### 1.4 Timezone is env-level — never inferred from the browser

The single bug that erodes trust irreparably: an operator in Paris sets
*"Monday 9am"* for a Tunis team, mid-DST. It fires at the wrong hour.
They lose trust in every other schedule they ever set.

The rule:
- Every env declares its timezone at create time (default UTC, editable).
- Schedules persist in **env-tz** (`schedule_cron` is an IANA-tz cron).
- Every UI surface shows the schedule in env-tz (primary, mono) AND the
  browser's tz (secondary, muted) — never silently.
- Even Slack message footers say *"sent 09:00 Africa/Tunis"*.

The browser tz is informational, never authoritative.

---

## 2 · Data model

Migration `0010_automations.sql`. Two tables: definitions and runs.

```sql
CREATE TYPE automation_status  AS ENUM ('draft','active','paused','disabled');
CREATE TYPE automation_run_st  AS ENUM ('queued','running','ok','failed',
                                        'timed_out','cancelled','suppressed');
CREATE TYPE automation_trigger AS ENUM ('cron','manual','preview');

CREATE TABLE automations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  env_id               UUID NOT NULL REFERENCES envs(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  prompt_text          TEXT NOT NULL,                -- the source NL; re-compileable
  compiled_plan        JSONB NOT NULL,               -- {read, render, send}
  plan_compiler_model  TEXT NOT NULL,                -- audit which LLM compiled it
  plan_compiled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  schedule_cron        TEXT NOT NULL,                -- '0 9 * * 1'
  schedule_tz          TEXT NOT NULL DEFAULT 'UTC',  -- IANA, e.g. 'Africa/Tunis'
  next_run_at          TIMESTAMPTZ,                  -- NULL when paused/disabled
  last_run_at          TIMESTAMPTZ,
  status               automation_status NOT NULL DEFAULT 'draft',
  consecutive_failures INT NOT NULL DEFAULT 0,
  daily_cost_cap_usd   NUMERIC(10,4) NOT NULL DEFAULT 1.00,
  per_run_token_cap    INT NOT NULL DEFAULT 50000,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (env_id, name)
);

-- The dispatcher's hot path. Partial index so the planner only walks
-- rows that are actually due to fire.
CREATE INDEX automations_due_idx ON automations (next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;

CREATE TABLE automation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  env_id        UUID NOT NULL REFERENCES envs(id) ON DELETE CASCADE,  -- denormalised
                                                                     -- for fleet view
  occurrence_ts TIMESTAMPTZ NOT NULL,    -- the SCHEDULED slot, not the start time
  trigger       automation_trigger NOT NULL,
  status        automation_run_st  NOT NULL DEFAULT 'queued',
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  step_trace    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- mirrors argus_tool_trace
  output_text   TEXT,                                  -- what got sent
  tokens_used   INT,
  cost_usd      NUMERIC(10,6),
  error_class   TEXT,                                  -- 'provider_5xx' | …
  error_detail  TEXT,
  UNIQUE (automation_id, occurrence_ts)
);

CREATE INDEX automation_runs_env_recent_idx  ON automation_runs (env_id, started_at DESC);
CREATE INDEX automation_runs_auto_recent_idx ON automation_runs (automation_id, started_at DESC);
```

**Why `step_trace` is a JSONB column, not a `automation_steps` table.**
The shape is identical to `argus_tool_trace` (already in
`apps/api/src/llm/chat.ts`). At 100k runs/day, doubling write amplification
for a join nobody queries is a tax we don't pay. Add the table when
step-level retry-from-here becomes a feature.

**Why `UNIQUE(automation_id, occurrence_ts)` is the load-bearing constraint.**
It's the idempotency anchor across three systems: Postgres scheduling
truth, Redis BullMQ execution, and the Slack double-send risk. The
dispatcher uses it to prevent enqueuing twice; the runner uses it to
short-circuit if a previous instance already sent.

---

## 3 · The plan JSONB shape

```json
{
  "read": {
    "connector_id": "<uuid>",
    "connector_subtype": "postgres",
    "sql_template": "SELECT date_trunc('week', created_at) AS week, count(*) AS orders, sum(total) AS revenue FROM orders WHERE created_at >= now() - interval '1 week' GROUP BY 1 ORDER BY 1 DESC",
    "row_cap": 100
  },
  "render": {
    "model": "gemini-2.5-flash",
    "system_prompt_override": null,
    "user_template": "Summarise last week's order data for #leadership. Be terse, lead with the most interesting trend, cite specific numbers. Data:\n{{rows}}"
  },
  "send": {
    "connector_id": "<uuid>",
    "connector_subtype": "slack",
    "channel": "#leadership",
    "format": "blocks"
  }
}
```

The compiler's job (next push) is to take *"every Monday 9am pull last
week's orders and post to Slack #leadership"* and produce that JSON. It
must validate that:
- `read.connector_id` exists, is enabled, and has the columns the SQL
  references
- `send.connector_id` exists, is a channel-kind connector
- The SQL passes the read-only safety guard from `agent/db-query.ts`

If validation fails, save fails with a structured error the UI shows
inline ("Connector `acme-prod` doesn't have an `orders` table — pick a
different connector or upload the schema first").

---

## 4 · Execution model

```
                          ┌──────────────────────────┐
                          │  Postgres                │
                          │   automations            │ ← schedule truth
                          │   (next_run_at indexed)  │
                          └──────────┬───────────────┘
                                     │ every 5s
                                     ▼
                          ┌──────────────────────────┐
                          │  dispatcher tick         │ one BullMQ repeatable,
                          │  (in apps/api Fastify)   │ system-wide singleton
                          │                          │
                          │  SELECT … LIMIT 500       │
                          │  WHERE next_run_at <      │
                          │    now() AND status='active'│
                          │                          │
                          │  for each row:           │
                          │   CAS-advance next_run_at│
                          │   enqueue('automation.run',│
                          │     {automation_id, occurrence_ts},│
                          │     {jobId: 'auto:<id>:<ts>'})│
                          └──────────┬───────────────┘
                                     │ jobId dedup
                                     ▼
                          ┌──────────────────────────┐
                          │  shared queue            │
                          │  'automation.run'        │
                          │  concurrency 50 system,  │
                          │  per-org cap 10          │
                          └──────────┬───────────────┘
                                     ▼
                          ┌──────────────────────────────────┐
                          │  runner worker                   │
                          │                                  │
                          │  1. INSERT automation_runs       │
                          │     (status='running')            │
                          │     ON CONFLICT do nothing        │  ← idempotency
                          │                                  │
                          │  2. read step:                    │
                          │     runQueryViaConnector(         │
                          │       read.connector_id,          │
                          │       read.sql_template)          │
                          │                                  │
                          │  3. render step:                  │
                          │     runGroundedChat(              │
                          │       env_id,                     │
                          │       render.model,               │
                          │       expand(render.user_template,│
                          │              rows))               │
                          │                                  │
                          │  4. send step:                    │
                          │     sendViaConnector(             │
                          │       send.connector_id,          │
                          │       send.channel,               │
                          │       text)                       │
                          │                                  │
                          │  5. UPDATE automation_runs        │
                          │     SET status='ok',              │
                          │         output_text, tokens, cost │
                          └──────────────────────────────────┘
```

**Where the dispatcher lives**: inside the existing `apps/api/` Fastify
process (one singleton `BullMQ.Worker` instance booted alongside the
HTTP server). A separate `apps/scheduler` workspace package is over-engineering
for v1; on restart the dispatcher picks back up from `automations.next_run_at`
which is in Postgres.

A separate process becomes warranted at >10k automations/env. Plenty of
runway.

---

## 5 · Safety boundary

### Preview gate

Every `draft` automation MUST be previewed at least once before going
`active`. The preview:
- Compiles the plan (or uses the already-compiled one)
- Executes the read step against the live connector
- Runs the render step against the LLM
- **Does NOT execute the send step.** The generated text is displayed
  in the dashboard's preview modal, plus offered as a "Send a test to me
  only" DM via the channel adapter
- Counts against `daily_cost_cap_usd` (yes — preview costs are real)
- Goes against a separate **draft soft cap** so iterative authoring
  doesn't blow the daily cap

The operator clicks *Activate schedule* to flip `status='draft' →
'active'` and set `next_run_at` to the next slot. **Activation is the
only path that schedules sends.**

### Cost caps

| Cap | Default | What happens at limit |
|---|---|---|
| `per_run_token_cap` | 50000 | Run aborts at LLM-router boundary; `status='failed'`, `error_class='budget_per_run'`. Does NOT auto-pause. |
| `daily_cost_cap_usd` | $1.00 | Subsequent runs the same UTC day return `status='suppressed'` at dispatcher level — no LLM call, no send. |

Both are per-automation. An env-level cap can be added later if a tenant
runs many cheap automations and we want to limit the cumulative spend.

### Per-org / per-env concurrency

| Lever | Default | Hard cap |
|---|---|---|
| Concurrent runs per system | 50 | 100 |
| Concurrent runs per org | 10 | 50 |
| Concurrent runs per env | 5 | 25 |

These prevent one runaway tenant from DoSing the LLM provider or the
shared queue.

### Auto-pause

5 consecutive `failed` runs (any error_class except `provider_5xx` and
`budget_*`) → `status='paused'`. The owner is notified via the audit
event stream. Manual *Resume* required.

---

## 6 · Failure semantics

| Failure | What happens |
|---|---|
| **Dispatcher crashes mid-batch** | `UPDATE … WHERE next_run_at = $expected` CAS rejects already-advanced rows on restart; BullMQ `jobId` dedupes already-enqueued. Worst case: a tick is skipped. Never doubled. |
| **Worker crashes after Slack post, before DB write** | The runner writes `automation_runs.status='running'` BEFORE the send. On retry, the runner checks the row first — if `output_text IS NOT NULL`, it short-circuits to `suppressed` to avoid double-posting. `UNIQUE(automation_id, occurrence_ts)` is the anchor. |
| **Gemini 503 / transient** | 3 retries with exponential backoff (1s, 4s, 15s). Final failure → `status='failed', error_class='provider_5xx'`. Does NOT increment `consecutive_failures`. |
| **Connector unreachable, channel deleted, auth revoked** | `error_class='connector_permanent'`. Increments `consecutive_failures`. 5 consecutive → auto-pause + notify. |
| **`per_run_token_cap` exceeded** | Run aborts at the router boundary. `status='failed', error_class='budget_per_run'`. No auto-pause. |
| **`daily_cost_cap_usd` exceeded** | Same UTC day's subsequent runs return `status='suppressed'` immediately. No LLM call. No send. |
| **Two writers race on the same automation** | CAS on `next_run_at`. Concurrent dashboard edits use `updated_at` optimistic lock + 409. |

---

## 7 · UX surface (the ux-lead's design)

### `/automations` list view at 8 automations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Automations                                          env: acme-prod ▾       │
│ Tell Argus what to do and when. It runs on schedule, posts to your channels,│
│ and shows you every run.                                                    │
│                                                                             │
│ ┌────────┐ ┌──────────────┐ ┌──────────────────┐ ┌────────────┐             │
│ │ Active │ │ Failed today │ │ Suppressed (cost)│ │ Next run   │             │
│ │   8    │ │   1  ●       │ │   0              │ │   in 7m    │             │
│ └────────┘ └──────────────┘ └──────────────────┘ └────────────┘             │
│                                                                             │
│ [search…       ]   [All] [Failing] [Paused]                    [+ New]      │
│                                                                             │
│ ▎ Weekly orders summary                              next: Mon 09:00 (Tunis)│
│ ▎ Every Mon 09:00 · postgres/acme-prod → slack/#leadership   last: ok · 2d  │
│                                                                             │
│ ▎ Daily error-rate digest                            next: tomorrow 08:00   │
│ ▎ Every day 08:00 · postgres/acme-prod → email/ops          last: ok · 4h   │
│                                                                             │
│ ▎ Stuck-orders alert                          ●      next: in 7m            │
│ ▎ Every 15m · postgres/acme-prod → slack/#ops-alerts last: FAILED · 22m     │
│ ▎ ↳ connection refused: acme-prod                         [view] [retry]    │
│                                                                             │
│ … (5 more) …                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
   ▎ = 4px left rail · green / amber / red / grey
```

Why list, not cards: at 200+ rows, cards are unscannable. The most-asked
question at scale is *"which broke today"* — a 4-tile fleet summary plus
a status-rail list answers that in two glances.

### Cron picker

Default to structured:
*"Every [Day | Weekday | Mon/Wed/Fri | Custom days] at [09:00] in [Africa/Tunis (env tz)]"*

Below: muted mono line *"cron: 0 9 * * 1 · next 3 runs: Mon Jun 29
09:00, Mon Jul 6 09:00, Mon Jul 13 09:00 — Africa/Tunis"*.

Toggle *"Use cron expression"* swaps the structured picker for a raw
cron text input with live validation. Same "next 3 runs" preview either
way.

The NL prompt describes the WORK. The schedule is structured. Two
different problems; don't mix them.

### Prompt input — Playground-shaped, with detected-entities chips below

```
┌─────────────────────────────────────────────────────────────────┐
│ Prompt                                                          │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Every Monday 9am Tunis time, pull last week's order totals  │ │
│ │ from Postgres and post a summary to Slack #leadership.      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Detected:                                                      │
│   IN  postgres · acme-prod        ✓                             │
│   OUT slack    · #leadership      ✓                             │
│   WHEN Mon 09:00 Africa/Tunis     ✓                             │
│   EST ~$0.004 / run · ~1.2k tokens                              │
└─────────────────────────────────────────────────────────────────┘
```

The chips render live as the operator types or pastes. Missing connector
→ amber chip *"not connected — connect now"* with a deep-link to
`/connectors?env=…`. Cost estimate appears only once the plan compiles
successfully.

### Preview modal — full-screen, three stacked panels

1. **Compiled plan** (collapsible) — read-only block showing
   `read.connector`, `read.sql`, `render.model`, `send.channel`,
   `schedule`. Per-row "Edit" drops back into the prompt editor.
2. **Generated output** (primary surface) — the actual text that would
   be posted, rendered like a Playground bubble with citation chips.
3. **Where it would go** (bottom) — a mock Slack card preview, plus a
   *"Send a test to me only (DM)"* button that actually fires once.

Footer actions: `Edit prompt` · `Activate schedule` (primary, accent) ·
`Discard`. No auto-activation. Until *Activate* is clicked, NOTHING is
scheduled.

### Run history

Default: time-descending list of runs. One row per run with status dot,
date + relative time, short output snippet, trailing tokens/$/latency in
mono. Click expands inline.

Above the list: a 30-day strip of 4×4px day-cells (GitHub-contributions
heatmap, but compact). Click scrolls to that day. Two questions, two
answers:
- *"Did it fire when expected?"* → heatmap, one glance
- *"What did it actually post?"* → expandable rows

### Sidebar placement: new `Operate` group

`Engine` (build the brain) hosts Connectors, Channels, Models, Environments.

`Operate` (put it to work) is a new group below. M8.1 adds Automations.
Future siblings: Alerts (M9?), Workflows (M10?).

Why a new group: keeps the "wires the brain" / "uses the brain" mental
split that Engine has already established. Don't pollute Engine with
process entities.

---

## 8 · The compiler (next push, M8.2 — sketched here)

The hardest piece. The operator writes English. The compiler produces
deterministic JSON.

Sketch:

```ts
// apps/api/src/automations/compiler.ts
export async function compilePlan(
  envId: string,
  promptText: string,
  llm: ProviderRow,
): Promise<{ plan: CompiledPlan; warnings: string[] }> {
  // 1. List the env's available connectors (just IDs + subtype + name)
  const connectors = await db().query(`
    SELECT id, subtype, name, config FROM env_connectors
     WHERE env_id = $1 AND enabled
  `, [envId])

  // 2. Single LLM call with strict JSON output:
  //    - given the prompt + the connector inventory
  //    - return {read: {connector_id, sql_template, row_cap},
  //              render: {model, user_template},
  //              send: {connector_id, channel, format},
  //              schedule_cron, schedule_tz, name}
  //    - if any field is unknowable, return {warnings: [...], plan: null}
  //
  //    Same structured-output approach as the SQL planner (M7.4) —
  //    JSON parse + re-prompt once on failure.

  // 3. Validate the plan:
  //    - all referenced connector_ids exist in this env
  //    - read.sql_template passes isReadOnlyStatement()
  //    - render.model is a known model
  //    - send.connector is kind='channel'
  //    - schedule_cron parses with cron-parser

  // 4. Return {plan, warnings}.
}
```

The plan is then a frozen artifact. Re-compilation is an explicit
operator action.

---

## 9 · What ships in M8.1 vs deferred

| In M8.1 (foundation) | Deferred |
|---|---|
| Migration 0010 | Compiler (M8.2) |
| Fastify CRUD routes for automations | BullMQ dispatcher + runner (M8.3) |
| `/automations` UI: list + create-drawer + structured cron picker | Run history view (M8.4) |
| Preview endpoint (executes read step, returns generated text, doesn't send) | Heatmap strip on history (M8.4) |
| Pause/Resume/Run-Now manual actions | Fleet-view tiles (M8.5) |
| Sidebar `Operate` group + Automations nav item | |

Explicitly NOT in M8 at all (push back if proposed):

- Multi-channel fan-out (one prompt → multiple Slack channels)
- DAG / branching ("if X then send to A else send to B")
- Non-cron triggers (webhook + events land in v0.7 if at all)
- Inter-automation dependencies ("after automation A finishes, run B")
- Auto-recompile on schema drift (operator clicks Recompile manually)
- Multiple IN connectors per automation
- Multiple OUT channels per automation

These features individually are reasonable; together they turn Argus
into Zapier-but-worse. Land the linear cron-prompt-channel triple first;
let community + customer use shape what gets added.

---

## 10 · Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Cron-string DST drift** | Persist `schedule_tz` IANA. Dispatcher computes next_run_at using a tz-aware cron-parser, not naive UTC arithmetic. |
| **LLM compiles the wrong connector at save time** | Detected-entities chips show the compiler's choice BEFORE save. Operator can edit prompt or pick a different connector via dropdown. Preview gate catches the rest. |
| **Cost explosion from a runaway prompt** | `per_run_token_cap` aborts the run; `daily_cost_cap_usd` suppresses subsequent runs the same day. Defaults are conservative. |
| **Slack double-post on worker crash** | `UNIQUE(automation_id, occurrence_ts)` + runner checks `output_text IS NOT NULL` before sending. At-least-once delivery, exactly-once observable effect. |
| **Compile-stable plan, drifted schema** | Operator sees the failure in the run-history view. Manual "Recompile" button rebuilds the plan from the same `prompt_text`. Auto-recompile is a foot-gun; never auto. |
| **Operator believes preview = real run** | Modal explicitly labels *"Preview — nothing is scheduled. Activate to schedule the first real run."* Activation button is the only path to a scheduled state. |
| **1 tenant DoSes the queue** | Per-org / per-env concurrency caps. BullMQ priority + jobId prefix per tenant. |

---

## 11 · Folder layout

```
apps/api/src/
├── routes/
│   └── automations.ts            # CRUD + preview + pause/resume/run-now
└── automations/
    ├── compiler.ts               # M8.2 — prompt → plan JSON
    ├── runner.ts                 # M8.3 — orchestrates read/render/send
    ├── dispatcher.ts             # M8.3 — the every-5s tick, in api boot
    └── schedule.ts               # cron parsing + next-run computation,
                                  # tz-aware

docker/postgres/migrations/
└── 0010_automations.sql

apps/dashboard/src/app/automations/
├── page.tsx                      # list + fleet tiles
├── new/page.tsx                  # create drawer + cron picker + preview modal
└── [id]/page.tsx                 # detail + run history + heatmap
```

---

## 12 · Summary

The product loop is one English sentence, one structured plan compiled
at save time, an unbreakable schedule, a preview gate before going live,
and a 30-day visual heatmap of every run. The compiler is the novel
piece; everything else is straightforward use of the BullMQ + Postgres
stack already in place. Reuses `runGroundedChat` for grounding and
citations. Reuses `env_connectors` for credentials. Reuses the
marketplace UI vocabulary for visual continuity.

Foundation lands in M8.1 (the migration + CRUD routes + sidebar slot).
Compiler in M8.2. Execution + runners in M8.3. Polished UX in M8.4–5.
