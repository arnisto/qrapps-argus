#!/usr/bin/env bash
# Smoke test for the v0.1 stack.
# Run after `docker compose up`. Verifies:
#   1. /healthz responds
#   2. /readyz reaches Postgres
#   3. The bearer-token gate works
#   4. POST /v1/events accepts a delivery.completed
#   5. GET /v1/events shows it back
#   6. GET /v1/investigators returns the seeded builtins
#
# Does NOT test investigator runs end-to-end — that requires an AI provider key.
set -euo pipefail

API="${API:-http://localhost:4000}"
TOKEN="${ARGUS_INGEST_TOKEN:-$(grep '^ARGUS_INGEST_TOKEN=' .env | cut -d= -f2 | awk '{print $1}')}"
H_AUTH="Authorization: Bearer ${TOKEN}"

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
die() { printf '  \033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

say "1. /healthz"
curl -fsS "$API/healthz" >/dev/null && ok "healthz OK" || die "healthz failed"

say "2. /readyz (Postgres reachable)"
curl -fsS -H "$H_AUTH" "$API/readyz" >/dev/null && ok "readyz OK" || die "readyz failed"

say "3. Bearer-token gate"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/events")
[ "$code" = "401" ] && ok "401 without token" || die "expected 401, got $code"

say "4. POST /v1/events"
EVT_ID="evt_smoke_$(date +%s)"
curl -fsS -X POST "$API/v1/events" \
  -H "$H_AUTH" -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"$EVT_ID\",
    \"event_type\": \"delivery.completed\",
    \"occurred_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"source\": {\"connector_id\": \"smoke\", \"connector_type\": \"manual\"},
    \"subject\": {\"type\": \"delivery\", \"id\": \"DLV-SMOKE\"},
    \"payload\": {\"driver_id\": \"DRV-001\", \"lat\": 48.8566, \"lng\": 2.3522, \"status\": \"completed\"}
  }" >/dev/null
ok "event accepted: $EVT_ID"

say "5. GET /v1/events"
sleep 1   # let the events:process worker write to the table
count=$(curl -fsS -H "$H_AUTH" "$API/v1/events?type=delivery.completed&limit=5" | grep -o '"event_id"' | wc -l)
[ "$count" -ge 1 ] && ok "$count event(s) visible" || die "no events returned"

say "6. GET /v1/investigators"
inv=$(curl -fsS -H "$H_AUTH" "$API/v1/investigators" | grep -o '"id"' | wc -l)
[ "$inv" -ge 2 ] && ok "$inv investigator(s) registered" || die "expected ≥2 builtins (run pnpm db:seed?)"

printf '\n\033[1;32m▸ Smoke test passed.\033[0m\n'
