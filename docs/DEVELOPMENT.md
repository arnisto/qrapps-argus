# Development

Local dev workflow for hacking on Argus.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- Docker + Docker Compose v2
- An API key for at least one AI provider (Claude or OpenAI)

## First-time setup

```bash
git clone https://github.com/qrapps/argus.git
cd argus
cp .env.example .env
# edit .env: set ARGUS_CLAUDE_API_KEY or ARGUS_OPENAI_API_KEY
pnpm install
```

## Two ways to run

### Option A — Full Compose (recommended for first try)

```bash
docker compose up
```

Brings up Postgres, Redis, API, workers, and dashboard. Hot-reload enabled in dev mode via the `dev` compose override.

- Dashboard: http://localhost:3000
- API: http://localhost:4000
- Postgres: `localhost:5432` (user `argus`, db `argus`)
- Redis: `localhost:6379`

### Option B — Infra in Compose, apps locally (faster iteration)

```bash
docker compose up postgres redis
pnpm dev
```

`pnpm dev` runs all apps in parallel via Turbo: api, workers, dashboard. Each reloads on file change.

## Useful commands

```bash
# Run everything
pnpm dev

# Single workspace
pnpm --filter @argus/api dev
pnpm --filter @argus/workers dev
pnpm --filter @argus/dashboard dev

# Build all
pnpm build

# Type-check all
pnpm typecheck

# Lint
pnpm lint

# Test
pnpm test

# Migrate the database
pnpm db:migrate

# Seed sample data (deliveries, refunds, drivers)
pnpm db:seed

# Reset the database (DROP + migrate + seed)
pnpm db:reset

# Run an investigator manually against historical events
pnpm investigator:test ghost-delivery --since 7d
```

## Project layout in your editor

```
qrapps-argus/
├── apps/
│   ├── api/          → Fastify HTTP API
│   ├── workers/      → BullMQ workers
│   └── dashboard/    → Next.js dashboard
├── packages/
│   ├── shared/       → types, logger, config
│   ├── events/       → event schema + bus
│   ├── connectors/   → data source connectors
│   ├── investigators/→ investigator runtime + templates
│   └── ai-providers/ → provider abstraction
├── docker/           → Dockerfiles + init scripts
├── infra/            → compose overrides, seed data
└── docs/             → you are here
```

## Adding a dependency

```bash
# To a specific workspace
pnpm --filter @argus/api add fastify

# Dev dep at root
pnpm add -Dw vitest
```

## Common tasks

### Add a new event type

1. Register the type in `packages/events/src/types.ts`.
2. Add Zod schema if the payload has a stable shape.
3. Update `docs/EVENTS.md` with the naming and example.

### Add a new investigator (builtin)

1. Create `packages/investigators/templates/<id>.yaml`.
2. Add tests in `packages/investigators/src/__tests__/<id>.test.ts` using fixture events.
3. Run `pnpm investigator:test <id> --fixtures` and confirm output.
4. Update `docs/INVESTIGATORS.md` builtin list.

### Add a new AI provider

See [AI_PROVIDERS.md § Adding a new provider](./AI_PROVIDERS.md#adding-a-new-provider).

### Add a new connector

See [CONNECTORS.md § Writing a custom connector](./CONNECTORS.md#writing-a-custom-connector-post-v03-plugin-sdk).

## Debugging

- **API logs**: `docker compose logs -f api`
- **Worker logs**: `docker compose logs -f workers`
- **Postgres**: `docker compose exec postgres psql -U argus -d argus`
- **Redis**: `docker compose exec redis redis-cli`
- **BullMQ inspection**: `pnpm queues:inspect` (lists queues, depth, failures)

## Style

- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Format: Prettier (config at root). Lint: ESLint.
- Imports sorted by `eslint-plugin-simple-import-sort`.
- Tests: Vitest.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).

## What to read first if you're new

1. [VISION.md](./VISION.md) — what we're building
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — how it fits together
3. [MVP_SCOPE.md](./MVP_SCOPE.md) — what's actually in v0.1
4. The investigator runtime in `packages/investigators/src/runtime.ts`
5. One builtin: `packages/investigators/templates/ghost-delivery.yaml`
