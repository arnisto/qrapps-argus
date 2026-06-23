# Status — 2026-06-22

Where the knowledge-layer product stands. Updated when a milestone lands.

## TL;DR

Argus pivoted from the original observability product into a
**knowledge-layer-in-front-of-any-LLM**. The end-to-end demo loop works:
a developer signs up, creates an env, connects Gemini (and optionally
Groq), uploads a document or pastes a Q&A pair, asks a question in the
Playground OR via an OpenAI-compatible `/v1/chat/completions` curl, and
gets back a grounded answer with citation chips pointing at the chunks
that grounded it. Members can be invited via shareable link.

Five back-to-back milestones (M1–M5) landed in `main`, plus three
follow-up pushes (Groq · UX polish · responsive + SaaS).

## What's in `main`

| Commit | What |
|---|---|
| `0b95cf0` | **M1** — versioned migration runner + auth/orgs/envs/knowledge schema (12 tables in `public/`) |
| `1935741` | **M2** — Fastify auth routes (signup/signin/signout/me) with session cookies |
| `64163a7` | **M3** — Next.js sign-in / sign-up + authed `/environments` |
| `50cda6d` | fix — block open-redirect on `/signin?next=…` post-auth bounce |
| `7aed8a5` | **M4** — middleware auth gate + Fastify envs CRUD + Odoo-style UI in Next.js |
| `b5d8778` | **Design import** — full Argus Console shell + 16 nav routes (warm-light + dark theme) |
| `e45462a` | **M5** — grounded `/v1/chat/completions` end-to-end (Gemini-only) |
| `f2d78a5` | **M5d** — full demo UI: Models / Teach / Developer API / Ask |
| `7442e2a` | Groq provider — chat-only alongside Gemini, routed by model name |
| `407f4ad` | Teach-then-ask loop + UX polish from review panel |
| `bc31a59` | Responsive shell + shared provider keys + Members SaaS MVP |
| _(v0.4.0 tag — 2026-06-22)_ | first tagged release: shipping the knowledge layer |
| `961bca0` | **M7.1** — Connectors marketplace + PostgreSQL adapter (read-only schema crawl + chunks) |
| `5ec42ae` | **M7.2** — Channels marketplace + Slack adapter (outbound) |
| `c80676b` | **M7.4** — live `db.query` agent tool + OSS polish + docker-compose one-command install |
| `82ea3f0` | docs — embedded 6 README screenshots |
| `464c74d` | **M8.1** — automations foundation (schema 0010 + Fastify CRUD + ARCHITECTURE_AUTOMATIONS.md) |
| `8459c7b` | **M8.2 + M8.3 + M8.4** — compiler + BullMQ dispatcher + runner + `/automations` UI |
| _(v0.5.0-rc1 tag — 2026-06-23)_ | "automations" release candidate: a real cron-driven LLM ops loop |

## What works end-to-end (verified in the browser today)

1. **Auth** — signup creates user + personal org + owner membership atomically; signin/signout with HTTP-only session cookies; bcrypt(12) hashes; sha256 token storage.
2. **Envs CRUD** — list / create / form view (rename, change model) / delete; scoped by org membership; slug global-unique with `-N` suffix on collision.
3. **Providers** — Gemini (required, for embeddings + chat) + Groq (optional chat). AES-GCM-encrypted at rest. Test ping verifies the upstream key. One-click "apply to all envs in this org".
4. **API keys** — `ak_live_<43 base64url>` minted per-env. Plaintext shown ONCE. sha256-hashed at rest. Rate-limit + last-used.
5. **Sources** — multi-part file upload (.md / .txt / .html, 5 MB max). Inline chunking + embedding via Gemini. Q&A pairs (higher authority). Sources list + delete.
6. **Chat** — `POST /v1/chat/completions` (Bearer-authed) AND `POST /envs/:slug/ask` (session-authed). Shared `runGroundedChat()` engine in `llm/chat.ts`. Sim threshold 0.6 to gate against irrelevant retrievals → triggers `argus_warning: "no_grounded_context"`.
7. **Playground** — chat UI with bubbles, clickable citation chips, "Knowledge gap" inline teach-the-answer panel, auto-resend after teach. 916 ms / 215 tokens / $0.000144 typical reply.
8. **Members & invitations** — invite by email + role (member / admin / owner). Last-owner guard. 14-day token TTL. Public preview page. Invite-link flow supports sign-up-then-accept in one form.
9. **Responsive** — slide-over sidebar on mobile, hamburger toggle, body-scroll lock, auto-close on nav. TopBar collapses non-essential pills at smaller widths. Tables wrap in horizontal scroll.
10. **Design system** — IBM Plex Sans/Mono + warm-neutral light theme (default) + true dark theme via `.dark` class. No-flash dark bootstrap. Hand-authored SVG nav icons. CSS-variable tokens drive Tailwind utilities.
11. **Connectors marketplace + PostgreSQL** — `/connectors` page with the shared `<Marketplace>` primitive; search + kind-filter chips + click-to-connect drawer. PG adapter crawls `information_schema`, embeds DDL + sample rows as `db_schema` chunks at authority 70, three-layer read-only defense (operator role + `SET TRANSACTION READ ONLY` + SQL safety guard). The crawled schema becomes citable knowledge in `/v1/chat`.
12. **Channels marketplace + Slack outbound** — `/channels` page uses the same `<Marketplace>` primitive filtered to `kind='channel'`. Slack adapter validates the bot token via `auth.test` on connect, sends a Block-Kit "connection test" card via the connected card's "Send test" action. Same `env_connectors` table — `kind` discriminates db vs channel.
13. **Live `db.query` agent tool** — `runGroundedChat` detects `db_schema` chunks in retrieval, runs the SQL planner against the question + chunks, executes the resulting SELECT against the live PG via the same three-layer safety, injects the rows into the grounding context, and returns the answer with both `argus_citations[]` AND `argus_tool_trace[]`. "How many rows in the agents table?" → real `SELECT count(*)` → grounded reply.
14. **Automations** — `/automations` page with 4-tile fleet view, status-rail rows, and the create drawer's structured cron picker. Compiler turns one English sentence into a `{read, render, send}` plan via Gemini Flash; validation layer rejects bad connector refs / unsafe SQL / unparseable cron. BullMQ singleton dispatcher polls Postgres every 5s for due rows, CAS-advances `next_run_at`, enqueues with deterministic `jobId` (idempotent across crashes). Runner executes the 3-step pipeline (read → render → send), persists `automation_runs` rows with full step traces. Daily cost cap suppresses runs; 5 consecutive permanent failures auto-pause. Preview path runs read + render but skips the channel side-effect.

## Schema (after migration 0010)

14 tables in `public/` (added since 0008: `env_connectors`, `automations`, `automation_runs`):

```
users           (id, email, password_hash, name, …)
sessions        (user_id, token_hash, expires_at, …)
organizations   (id, slug, name, …)
memberships     (user_id, org_id, role)
invitations     (org_id, email, role, token_hash, expires_at, accepted_at)
envs            (org_id, slug, name, primary_model, …)
providers       (env_id, name, api_key_ct, api_key_iv, default_model, …)
api_keys        (env_id, name, key_prefix, key_hash, rate_per_min, …)
sources         (env_id, kind, title, uri, bytes, authority, …)
chunks          (env_id, source_id, ord, text, tokens, embedding vector(768))
requests        (env_id, api_key_id, provider, model, tokens, latency, cost, status)
env_connectors  (env_id, kind, subtype, name, config jsonb, secret_ct, secret_iv, status, …)
automations     (env_id, name, prompt_text, compiled_plan jsonb, schedule_cron, schedule_tz,
                 next_run_at, status, consecutive_failures, daily_cost_cap_usd, …)
automation_runs (automation_id, env_id, occurrence_ts, trigger, status, started_at,
                 step_trace jsonb, output_text, tokens_used, cost_usd, error_class, …)
_migrations     (filename, applied_at)
```

Plus legacy v0.2 tables (events, findings, investigators, agents, alert_channels, …) that the knowledge-layer product doesn't touch.

### Indexes that earn their keep at scale
- `chunks_embedding_idx` — HNSW cosine ANN on the 768d embedding column.
- `automations_due_idx` — **partial** index on `(next_run_at) WHERE status='active'`. The dispatcher's hot path: O(due rows) regardless of total rows in the table.
- `automation_runs_<auto|env>_recent_idx` — `(automation_id, started_at DESC)` + `(env_id, started_at DESC)` for per-automation history + fleet view.
- `automation_runs.UNIQUE(automation_id, occurrence_ts)` — the idempotency anchor across Postgres + Redis BullMQ + Slack double-send risk.

## What's intentionally stubbed (M6+)

Surfaces visible in the design but not wired:

- **Inbox** — inbound message ingestion (WhatsApp / email / Slack)
- **Pipelines** — Kanban tickets that Argus drafts replies for
- **Connectors** — beyond file upload (Notion / Drive / Postgres ingest)
- **Agents & tools** — multi-step pipelines (Classify → Retrieve → Draft → Approve)
- **Channels** — outbound message routing
- **Knowledge core** page — facts overview + freshness chart
- **Interview** — gap-filling loop driven from inbound chat
- **Security** — inbound/outbound interceptors (PII redaction, prompt-injection guards)
- **Audit log** — append-only, immutable view of every action
- **Settings** — org-level + per-user

They render as proper page chrome with an amber "ships in M6" badge so a stray demo click doesn't read as broken.

## Local stack

- Postgres (pgvector/pgvector:pg16) on host `:5435`
- Redis on host `:6381`
- Fastify API on host `:4000` (`pnpm -F @argus/api dev`)
- Next.js dashboard on host `:3033` (`pnpm next dev -p 3033`)

Full setup: [GETTING_STARTED.md](./GETTING_STARTED.md).

## Open known issues

- **Chrome MCP viewport is locked at 1920×** — can't visually verify mobile via the in-session browser tool. Use Chrome DevTools' device emulation (Cmd/Ctrl+Shift+M) on the host browser.
- **No HTTPS in dev** — session cookie is `secure` only when `NODE_ENV=production`. Fine for `localhost`; never deploy without HTTPS in front.
- **No SMTP wired** — invitations are link-only. Copy the URL from the dashboard and share via the channel you trust.
- **No multi-org switcher in UI** — the dashboard renders the user's first org. Multi-org membership works at the DB layer; the UI switcher ships in M6+.
- **PDF ingest** — not yet. `.md` / `.txt` / `.html` only. Adding `pdf-parse` is one paragraph but staged behind a content-extractor refactor.
- **`SHOW_ALL` flag** — 9 nav stubs are hidden by default; a `NEXT_PUBLIC_SHOW_ALL` flag to reveal them isn't wired yet (would take ~5 min).

## What ships next

Picked from the cofounder + product-owner panel reviews:

- **Mint key from the API page → seed it into the cURL snippet so the buyer's first paste in the terminal Just Works** (the "close" moment loses its punch when the snippet says `YOUR_ARGUS_KEY`).
- **Per-page env switcher in the sidebar's env-switcher pill** so changing env doesn't bounce the page.
- **Citation chunk inspector** with real chunk text (today the modal points the user back to /teach).
- **/settings/account** for password change + active session list (security hygiene).

Stretch goals tied to deals, not roadmap:

- Inbox / Pipelines / Channels — only if a buyer asks for the human-in-the-loop reply product
- Audit log + Security interceptors — only when an enterprise asks for SOC-2 prep
- Multi-org switcher in the UI — only when a user lands in >1 org organically (invite flow already supports it)
