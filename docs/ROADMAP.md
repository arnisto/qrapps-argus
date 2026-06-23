# Roadmap

Order is opinionated — items higher on the list ship first. Dates are
soft targets; "v0.X" tags get cut when the listed items are merged.

Vote on what should land next in the
[**v0.5 priorities discussion**](https://github.com/arnisto/qrapps-argus/discussions).

---

## ✅ Shipped — v0.4 ("the knowledge layer")

The core product loop end-to-end.

- **M1** — versioned migration runner + 12 auth/orgs/envs/knowledge tables in `public/`
- **M2** — Fastify auth routes (signup / signin / signout / me) with session cookies
- **M3** — Next.js sign-in / sign-up pages
- **M4** — middleware auth gate + envs CRUD scoped by org membership
- **Design import** — full Argus Console shell, IBM Plex, warm-light + dark theme, responsive
- **M5** — `POST /v1/chat/completions` OpenAI-compatible, RAG-augmented, with `argus_citations[]`
- **M5d** — full demo UI (Models · Teach · Developer API · Ask Argus)
- **Multi-provider routing** — Gemini + Groq via `providerForModel(model)`
- **Teach-then-ask loop** — inline "Knowledge gap" CTA in the Playground, auto-resend after teach
- **Responsive shell + shared keys + Members MVP** — invite-by-link with role + last-owner guard
- **M7.1** — Connectors marketplace + PostgreSQL adapter (read-only schema crawl + chunks)
- **M7.2** — Channels marketplace + Slack adapter (outbound, paste-tokens)
- **M7.4** — live `db.query` agent tool (text-to-SQL grounding with read-only safety)

---

## ✅ Shipped — v0.5-rc1 ("automations")

Scheduled jobs that read from a connector, render text via the LLM, and
send through a channel. All driven by one natural-language prompt
compiled at save time. See [`ARCHITECTURE_AUTOMATIONS.md`](./ARCHITECTURE_AUTOMATIONS.md)
for the full design.

- **M8.1** — `automations` + `automation_runs` schema; full Fastify CRUD;
  partial-index `automations_due_idx` hot path; `UNIQUE(automation_id,
  occurrence_ts)` idempotency anchor
- **M8.2** — compiler: NL prompt → `{read, render, send}` JSON via Gemini
  Flash, with strict-output retry and a validation layer that catches bad
  connector refs / unsafe SQL / unparseable cron BEFORE persisting
- **M8.3** — BullMQ dispatcher (5s tick, in-process singleton, CAS-advance)
  + runner (orchestrates `db.query` → `chatComplete` → `slack.send`) with
  3-step pipeline, per-run + daily cost caps, retry classes, auto-pause
  after 5 consecutive permanent failures
- **M8.4** — UI: `/automations` list with 4-tile fleet view + 4px status-rail
  rows + structured cron-picker drawer with raw-cron escape hatch and live
  `next 3 runs` preview; new `Operate` sidebar group

---

## 🟡 In-flight — v0.5 ("the company brain")

Pick what to prioritize in the
[v0.5 vote thread](https://github.com/arnisto/qrapps-argus/discussions).

- **M8.5** — Automations finishing touches: detail page with run-history
  timeline + 30-day heatmap strip, full-screen Preview modal (compiled plan
  / generated text / mock send target), inline compile-warning chips below
  the prompt textarea, activation flow.
- **M7.3** — Slack **inbound** webhook + Interview loop. Argus DMs the
  right teammate when a chat hits a gap, ingests their reply forever,
  answers the original asker. *Requires a public webhook URL — `ngrok`
  or a deploy.*
- **Bulk URL ingest** — paste a Notion / Confluence / GitHub README URL, Argus fetches + chunks it (no auto-sync yet).
- **Proactive interview** — day-one digest DMs to experts: "Reply with one answer per line; here are 5 HR questions to seed your knowledge core."
- **Account delete + data export** — GDPR baseline (right to erasure + portability).

---

## 🔵 v0.6 — "the connectors are real"

Land the second cluster of integrations once v0.5's UX patterns are proven.

- **MySQL / MariaDB** — clone of the Postgres adapter using `mysql2`.
- **Notion** — internal-integration token + workspace pages, ETag-based polling.
- **Google Drive** — OAuth + folder watcher (push notifications).
- **Email** — IMAP inbound + SMTP outbound. RFC2822 threading.
- **Web search** — `tavily` or `brave` API as an agent tool, observations only (never persisted as authoritative).
- **Background crawls** — move the 25-table sync cap into BullMQ so DBs with 100s of tables work cleanly.

---

## ⚪ v1.0 — "production-ready self-host"

- **Channel re-confirmation loop** — Q&A pairs older than 6 months get re-DM'd to the original answerer; superseded vs stale handled in retrieval.
- **Pinned-by-owner authority tier** — `sources.pinned=true` for "the boss said so" facts at authority 95.
- **Audit log** — append-only immutable view of every approve / answer / draft / ask / edit.
- **Per-env cost ceiling** — daily $ cap, returns 429 to `/v1/chat` when hit.
- **Citation chunk inspector** — click a `[#N]` chip, see the full source chunk text in a modal.
- **Mobile dashboard** — the responsive shell shipped but several tables need horizontal-scroll polish + sticky headers.
- **Comprehensive test suite** — Vitest coverage on `apps/api/src/{llm,agent,routes}/*` + integration tests via Docker compose.

---

## 🟣 Beyond — speculative ("if a contributor really wants to")

These appear in the design but aren't on a near-term path. Open a
[feature request](https://github.com/arnisto/qrapps-argus/issues/new?template=feature.md)
if you want to drive one of them.

- **Inbox / Pipelines / Channels triage** — Kanban tickets that Argus drafts replies for. The human-in-the-loop reply product. Big surface, needs a paying use case to justify.
- **MS Teams / Discord / SMS / WhatsApp Business** — channel adapters beyond Slack and Email. Each is a multi-day project (especially WhatsApp's Meta verification).
- **Salesforce / HubSpot / Intercom / Zendesk** — CRM connectors. Big OAuth surfaces, big payoff for B2B SaaS users.
- **Confluence / SharePoint** — enterprise doc sources.
- **Code interpreter / sandboxed Python tool** — would let Argus do math + parse uploaded data live.
- **Hosted-SaaS edition** — not on the maintainer's roadmap (Argus is OSS-self-hosted forever). A community fork could absolutely take this on.

---

## How priorities get set

1. **Real user feedback** beats the maintainer's instinct.
2. **Issues with concrete use cases** (not "would be cool if…") earn a M-number.
3. **PRs with a working adapter + smoke test** ship in the next minor.
4. **The maintainer's bias** is toward depth (better PG / Slack / Gemini)
   over breadth (5 new mediocre integrations). One excellent adapter
   beats three half-finished ones.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow.
