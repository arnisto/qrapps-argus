---
description: Bring up the argus local stack (Postgres, Redis, app) and tail logs. Uses the documented host ports (5434/6381/3033).
---

Start the argus local dev stack.

1. **Check what's already running** so we don't double-start:
   ```bash
   docker compose ps
   lsof -iTCP:5434 -iTCP:6381 -iTCP:3033 -sTCP:LISTEN 2>/dev/null
   ```
   If anything is already up on those ports, surface that and ask
   whether to attach to the existing stack or tear down first.

2. **Bring up services** if needed:
   ```bash
   docker compose up -d postgres redis
   ```
   Wait until both pass `docker compose ps` health checks before moving
   on. Don't `sleep`-loop — `docker compose wait` or poll healthcheck.

3. **Verify connectivity** (read-only sanity):
   ```bash
   PGPASSWORD=... psql -h localhost -p 5434 -U argus -d argus -c '\dt'
   redis-cli -p 6381 PING
   ```

4. **Run `pnpm db:migrate`** to ensure schema is current. If it errors,
   stop and surface the error — do NOT auto-`pnpm db:reset` (destructive).

5. **Start the app** in a background process and tail its logs:
   ```bash
   pnpm dev   # in background; tail the log file
   ```

6. **Report** the URLs:
   - Dashboard: http://localhost:3033
   - API: http://localhost:4000
   - Postgres: localhost:5434
   - Redis: localhost:6381

If any step fails, **stop and report** — don't keep going. The user
will redirect.
