# Changelog

All notable changes to Argus are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — knowledge-layer release (2026-06)

The product pivoted from the observability platform into a knowledge layer
that goes in front of any LLM. Everything below is part of that pivot; the
observability v0.2 work in the rest of this section still lives in `main`
under `legacy/` routes and is not part of the demo flow.

#### Auth + multi-tenancy
- Versioned migration runner (`apps/api/scripts/migrate.ts`) replacing the
  single-file `init.sql` model. Tracks applied files in `_migrations`.
- Migration `0007_knowledge_and_auth.sql` — 12 tables: `users`, `sessions`,
  `organizations`, `memberships`, `invitations`, `envs`, `providers`,
  `api_keys`, `sources`, `chunks` (with `vector(768)` + HNSW), `requests`.
- Migration `0008_provider_unique.sql` — `UNIQUE(env_id, name)` so provider
  upserts are atomic.
- `apps/api/src/auth/` — bcrypt(12) password hashing, sha256 session-token
  hashes, HTTP-only SameSite=Lax cookies, 30-day sliding TTL. Constant-time
  bcrypt compare on missing-user signin.
- `apps/api/src/routes/auth.ts` — `POST /auth/{signup,signin,signout}` +
  `GET /auth/me`. Signup creates user + personal org + owner membership
  atomically.
- `apps/api/src/auth/orgs.ts` — org-membership helpers
  (`listUserOrgs`, `userRoleIn`, `canWrite`); RBAC = owner > admin > member.

#### Envs (per-customer tenants)
- `apps/api/src/routes/envs.ts` — full CRUD scoped by org membership. Slug
  global-unique with `-N` collision suffix.

#### Knowledge layer
- `apps/api/src/llm/secret.ts` — AES-256-GCM at rest for provider API keys.
  `APP_SECRET` env or auto-bootstrapped at `~/.argus/secret` (mode 0o600).
- `apps/api/src/llm/gemini.ts` — Gemini chat + embeddings client.
  `gemini-embedding-001` with `outputDimensionality=768` to match the
  schema. `thinkingBudget=0` to keep structured-output reliable on the
  free tier.
- `apps/api/src/llm/groq.ts` — Groq client (OpenAI-compatible endpoint).
  Chat only — Groq has no embeddings API.
- `apps/api/src/llm/router.ts` — `providerForModel(model)`: `gemini-*` →
  Gemini, `llama-*` / `mixtral-*` / `groq/*` → Groq.
- `apps/api/src/llm/chunk.ts` — paragraph-boundary chunker (~2048 chars /
  256 overlap) + HTML strip.
- `apps/api/src/llm/retrieve.ts` — pgvector cosine ANN over k*3 + rerank
  by `sim × (0.5 + 0.5·authority) × (0.7 + 0.3·recency_decay)`.
- `apps/api/src/llm/chat.ts` — `runGroundedChat()` shared between the
  public `/v1/chat/completions` and the dashboard playground. Sim-threshold
  gate (0.6) drops irrelevant retrievals and fires
  `argus_warning: "no_grounded_context"`.
- `apps/api/src/routes/providers.ts` — per-env provider CRUD + Test ping.
  `apply_to_org` flag fans out to every sibling env in one atomic upsert.
- `apps/api/src/routes/api-keys.ts` — `ak_live_…` mint (plaintext shown
  once), list, revoke.
- `apps/api/src/routes/sources.ts` — multi-part file upload + Q&A endpoint.
  Inline chunk + embed + insert.
- `apps/api/src/routes/chat.ts` — `POST /v1/chat/completions`,
  Bearer-authed (NOT session), returns OpenAI shape + `argus_citations[]`.
- `apps/api/src/routes/playground.ts` — `POST /envs/:slug/ask`,
  session-authed twin of the public endpoint for the dashboard chat.
- `apps/api/src/auth/api-key.ts` — `verifyApiKey(bearer)`; sha256 lookup;
  touches `last_used_at` fire-and-forget.

#### Members & SaaS
- `apps/api/src/routes/members.ts` —
  `GET/DELETE /orgs/:slug/members/…`,
  `GET/POST/DELETE /orgs/:slug/invitations/…`,
  `GET /invitations/:token` (PUBLIC preview),
  `POST /invitations/:token/accept` (authed).
- 14-day TTL, sha256-hashed tokens, last-owner removal guard, role
  escalation guard (admins can only invite members).

#### Dashboard (Next.js 14 App Router)
- `apps/dashboard/src/middleware.ts` — session-cookie pre-filter
  redirecting unauthed users to `/signin?next=…` (with open-redirect
  guard).
- `apps/dashboard/next.config.js` — `/be/*` rewrites to Fastify so
  cookies scope to the dashboard origin.
- **(auth) route group** — `/signin`, `/signup`, public auth pages on a
  warm gradient backdrop.
- **`/dashboard`** — KPI tiles + a next-step checklist driven by real counts.
- **`/environments`** — Odoo-style list + form view. Per-env summary cards
  with "Open →" deep links to the per-env surfaces.
- **`/models`** — connect Gemini + Groq side-by-side. "Apply this key to
  my other N envs in {org}" checkbox when applicable. Real Test button.
- **`/teach`** — drag-or-click file upload AND inline Q&A form
  (also reused inside the Playground gap callout).
- **`/developer-api`** — base URL + key mint (copy-once panel) + cURL /
  Python / JavaScript tabbed snippet panel.
- **`/ask`** — chat with bubbles, clickable citation chips, "Knowledge
  gap" amber callout with inline teach-the-answer panel that
  auto-resends after the user fills the answer.
- **`/members`** — invite form, members table, pending invitations
  table; revoke + remove with safety guards.
- **`/invite/[token]`** — public landing that handles
  signed-in-accept / sign-in-then-accept / sign-up-then-accept in one
  component.
- **Argus Console shell** — TopBar (brand + org switcher + self-hosted
  badge + LiteLLM pill + theme toggle + initials avatar) + Sidebar with
  active-state from `usePathname` + GUARDRAILS ACTIVE footer card.
- **Responsive** — `AppLayout` split into server data-loader + client
  `ClientShell`. Slide-over sidebar on mobile (hamburger toggle in
  TopBar, backdrop, body-scroll lock, auto-close on nav). Pills hide at
  smaller widths. Tables wrap in horizontal scroll.
- **Theme** — IBM Plex Sans / Mono. Warm-neutral light (default) + dark
  via `.dark` class on `<html>` with a no-flash inline bootstrap.

#### Documentation
- Root `README.md` rewritten for the knowledge-layer product.
- `docs/GETTING_STARTED.md` end-to-end walkthrough.
- `docs/STATUS.md` reflects current state.

### Fixed
- `signin?next=…` open-redirect — `safeNext()` rejects absolute URLs,
  protocol-relative paths, and `/\\` backslash tricks.

### Security
- Provider API keys at rest are AES-256-GCM-encrypted (separate `ct` +
  `iv` columns).
- Argus API keys (`ak_live_…`) stored as sha256(plaintext) — plaintext
  shown ONCE at mint and never returned again.
- Sessions revocable by `DELETE FROM sessions`.
- Default `/v1/*` gate uses Bearer API key, NOT the dashboard session,
  so the legacy `ARGUS_INGEST_TOKEN` can't impersonate an env's key.

### Original observability work (still in `main`)

- Initial monorepo scaffold (`apps/`, `packages/`, `docker/`, `infra/`, `docs/`).
- Postgres connector (read-only, poll-based) with cursor management.
- Event schema, ingestion endpoint, and BullMQ-backed event bus.
- Investigator runtime with structured-output enforcement and evidence-cite validation.
- Two builtin investigators: `ghost-delivery`, `refund-anomaly`.
- AI provider abstraction with Claude + OpenAI + Gemini implementations and a `mock` test provider.
- Slack alert channel.
- Next.js dashboard (Findings, Investigators, Connectors).
- One-command Docker Compose stack.
- Documentation: VISION, ARCHITECTURE, MVP_SCOPE, ROADMAP, INVESTIGATORS, CONNECTORS, AI_PROVIDERS, EVENTS, DEVELOPMENT, CONTRIBUTING, OPEN_SOURCE_STRATEGY.
