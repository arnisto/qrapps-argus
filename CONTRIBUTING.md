# Contributing to Argus

Thanks for taking the time. This doc covers how Argus is structured, how
to set up a local dev loop, what kinds of contributions land easily, and
which ones to talk through in an issue first.

Argus is **AGPL-3.0** — see [LICENSE](./LICENSE). By submitting a
contribution you agree that it's licensed under those terms.

---

## What we accept

**Yes please** (open a PR directly):

- New **connectors** (kind=`db` / `doc` / `tool`) — Postgres is the
  template (`apps/api/src/connectors/adapters/postgres.ts`). MySQL,
  MongoDB, Notion, Drive — add the catalog entry + adapter + a smoke test.
- New **channel adapters** (kind=`channel`) — Slack is the template
  (`apps/api/src/connectors/adapters/slack.ts`). Discord, Teams, Telegram,
  SMS, WhatsApp Business — same pattern.
- Bug fixes with a regression test.
- Migration files (`docker/postgres/migrations/NNNN_…sql`) for additive
  schema changes. Mark idempotent (`IF NOT EXISTS`, `DO $$ … $$`).
- Documentation, examples, screenshots, demo recipes.
- Test coverage for `apps/api/src/llm/`, `apps/api/src/agent/`, the chat
  flow, the auth/orgs gates.

**Open an issue first** for:

- Schema changes that touch existing tables (we ship migration files,
  not schema rewrites).
- New top-level routes / page surfaces (the design has a fixed nav set —
  let's discuss before adding to the sidebar).
- Anything that changes the public `/v1/chat/completions` response shape
  (`choices[]`, `argus_citations`, `argus_warning`, `argus_tool_trace`)
  — that's a stable contract with API consumers.
- Anything that adds a new top-level workspace package
  (`packages/<new>`).

**No thanks** — out of scope today:

- Crypto-wallet / Web3 integrations.
- Multi-LLM aggregator features that overlap with LiteLLM / OpenRouter
  — Argus targets `/v1/chat` compatibility, not provider arbitrage.
- Inbox / Pipelines / Agents-pipeline surfaces — design stubs that
  aren't on the public roadmap yet.

---

## Local development

The full setup is in [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md).
TL;DR for contributors:

```bash
git clone https://github.com/arnisto/qrapps-argus.git
cd qrapps-argus
pnpm install

# bring up postgres + redis
docker compose up -d postgres redis

# migrations (one-shot — re-runs the new ones each time)
DATABASE_URL="postgres://argus:argus@localhost:5435/argus" \
  pnpm -F @argus/api db:migrate

# api (terminal 1)
cd apps/api
DATABASE_URL="postgres://argus:argus@localhost:5435/argus" \
REDIS_URL="redis://localhost:6381" \
ARGUS_INGEST_TOKEN="dev-bearer-token" \
pnpm dev

# dashboard (terminal 2)
cd apps/dashboard
INTERNAL_API_URL="http://localhost:4000" pnpm next dev -p 3033
```

Open http://localhost:3033 — signup, then click through.

Project ports:

- API: `:4000` (Fastify)
- Dashboard: `:3033` (Next.js 14 App Router)
- Postgres: `:5435` (pgvector/pgvector:pg16)
- Redis: `:6381`

---

## Code conventions

- **TypeScript everywhere.** Strict mode. Prefer `unknown` over `any`
  at boundaries.
- **Validation at the API boundary** with Zod (`apps/api/src/routes/*.ts`
  is the canonical example). Internal modules trust their inputs.
- **Workspace imports** use `@argus/<pkg>`. Same-folder imports stay relative.
- **No ORM** — raw SQL, parameterised queries. Migrations are
  numbered `NNNN_name.sql` under `docker/postgres/migrations/`.
- **Idempotent migrations** — use `CREATE TABLE IF NOT EXISTS`,
  `DO $$ … $$ EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER … ADD COLUMN IF NOT EXISTS`.
- **Secrets at rest** — AES-256-GCM (`apps/api/src/llm/secret.ts`).
  Never persist plaintext API keys. Store provider keys as
  `(secret_ct BYTEA, secret_iv BYTEA)`.
- **Per-env scope** — every read of a connector / source / chunk MUST
  join through `memberships`. Argus's #1 invariant is no cross-org leakage.
- **Comments**: don't restate code. Only explain *why* a choice was
  made (constraints, dead-ends ruled out, surprising trade-offs).

---

## Pull request checklist

- [ ] `pnpm -F @argus/api typecheck` clean
- [ ] `pnpm -F @argus/dashboard typecheck` clean
- [ ] If you touched the DB schema, a new migration file under
      `docker/postgres/migrations/`
- [ ] If you added a connector / channel, an entry in
      `apps/api/src/connectors/catalog.ts`
- [ ] If the change is visible in the UI, a screenshot in the PR description
- [ ] The PR description explains *why*, not just *what*

---

## Reporting bugs

Open an issue using the **Bug report** template — `.github/ISSUE_TEMPLATE/bug.md`.
Include:

- Argus commit SHA
- Reproduction (`pnpm dev` log + the request that failed)
- Expected vs. actual

Security disclosures: don't file public issues for vulnerabilities.
Email `hello@intigo.tn` instead.

---

## Code of conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
Be kind, especially in code review. We're all volunteers.
