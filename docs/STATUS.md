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

## Schema (after migration 0008)

12 tables in `public/`:

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
_migrations     (filename, applied_at)
```

Plus legacy v0.2 tables (events, findings, investigators, agents, alert_channels, …) that the knowledge-layer product doesn't touch.

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
