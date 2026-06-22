# qrapps-argus

**Knowledge-layer-in-front-of-any-LLM**. OpenAI-compatible
`/v1/chat/completions` that injects citations from documents + Q&A
pairs uploaded per env. Fastify API + Next.js dashboard + Postgres
(pgvector) + Redis. Multi-tenant via orgs → envs.

The original observability product (events / investigators / findings)
still lives in `apps/api` + `packages/*` under legacy paths, but no
demo flow touches it — it's parked, not removed.

## Layout

- `apps/api` — Fastify server, owns DB migrations under
  `apps/api/scripts/migrate.ts`
- `apps/dashboard` — Next.js 14 admin UI
- `apps/workers` — BullMQ worker processes (investigations, ingest)
- `packages/investigators` — investigator implementations
- `packages/connectors` — data-source connectors
  (pre-wired: `intigo-logistics-local` Postgres connector — see below)
- `packages/ai-providers` — Gemini / OpenAI wrappers
- `packages/events` — typed event bus
- `packages/shared` — cross-cutting utils + Zod schemas

## Commands

| Goal | Command |
|---|---|
| Install | `pnpm install` |
| Dev — full stack | `pnpm dev` (parallel: API :4000, dashboard :3000, workers) |
| Build all | `pnpm build` |
| Typecheck all | `pnpm typecheck` |
| Lint all | `pnpm lint` |
| Test all | `pnpm test` |
| Investigator test | `pnpm investigator:test` |
| Inspect queues | `pnpm queues:inspect` |
| DB migrate | `pnpm db:migrate` |
| DB seed | `pnpm db:seed` |
| DB reset | `pnpm db:reset` **← destructive, ask first** |
| Format | `pnpm format` / `pnpm format:check` |

## Local stack (host ports)

- Postgres (pgvector/pgvector:pg16): **5435** (compose mapping moved
  from 5434 after a port-conflict with intigo-brain-postgres)
- Redis: **6381**
- Fastify API: **4000** (`pnpm -F @argus/api dev`)
- Next.js dashboard: **3033** (`pnpm next dev -p 3033`)
- Pre-wired observability connector: `intigo-logistics-local` (legacy —
  see [[qrapps-argus-local-connector]]).

Note the knowledge-layer stack runs host-side, NOT via docker compose
for `api` / `dashboard` — the compose `argus-api` and `argus-dashboard`
images can drift out of sync; stop them before running host processes
on the same ports.

## Conventions

- **Imports**: `@argus/*` for workspace packages; relative for siblings.
- **Validation**: Zod at every API boundary (Fastify route schemas use
  `zod-to-json-schema`). Internal modules trust their inputs.
- **Tests**: Vitest, co-located. `pnpm test` runs the full sweep via Turbo.
- **Type safety**: strict TS; prefer `unknown` over `any` at boundaries.
- **Database**: raw SQL migrations under `apps/api/scripts/migrations/`
  driven by `migrate.ts`. No ORM. Use parameterised queries.

## Gemini / AI-provider gotchas

From `~/.claude/MEMORY.md` ([[qrapps-argus-gemini]]):
- Free-tier model requires `thinkingBudget=0` for structured output to
  work. Symptom of missing setting: empty response or truncated JSON.

## Guardrails

- **`pnpm db:reset` is destructive.** Always confirm with the user before
  running.
- **Never commit `.env`** — `.env.example` is the template.
- **Docker compose up** is the integration-test path; spinning up
  services ad-hoc tends to drift from the compose-defined topology.
- **Workers consume BullMQ queues** — killing a worker mid-job can leave
  a job in `active` forever. `pnpm queues:inspect` first.
