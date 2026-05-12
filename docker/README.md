# Docker

Per-service Dockerfiles and the Postgres init script.

## Files

- `api.Dockerfile` — builds `apps/api` (Fastify HTTP API). Targets: `dev`, `runtime`.
- `workers.Dockerfile` — builds `apps/workers` (BullMQ workers). Targets: `dev`, `runtime`.
- `dashboard.Dockerfile` — builds `apps/dashboard` (Next.js). Targets: `dev`, `runtime`.
- `postgres/init.sql` — runs once on first Postgres boot. Creates the v0.1 schema.

## Targets

Each Dockerfile defines a `dev` target (hot-reload, dev deps included) and a `runtime` target (slim, prod-only). The root `docker-compose.yml` uses `target: dev`. A separate `docker-compose.prod.yml` (lands in v0.2) will switch to `runtime`.

## Why per-service Dockerfiles instead of one mega-image

- Faster cache invalidation per app.
- Smaller production images (only the workspace's transitive deps).
- Each service's healthcheck and entrypoint stays close to its own setup.

## Common commands

```bash
# Build everything
docker compose build

# Rebuild one service
docker compose build api

# Tail logs
docker compose logs -f workers

# Shell into a container
docker compose exec api sh

# Reset Postgres (drops volume!)
docker compose down -v && docker compose up postgres
```
