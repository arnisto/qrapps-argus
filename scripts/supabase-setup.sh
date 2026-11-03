#!/usr/bin/env bash
# One-shot setup of the Argus Supabase project through the Management API.
#
# Needs SUPABASE_ACCESS_TOKEN (a personal access token of the Supabase account that OWNS the project) in
# apps/argus/.env.local. A per-command token keeps the CLI's own login (the Lovixa account) untouched.
#
# Does, idempotently:
#   1. applies every supabase/migrations/*.sql not yet recorded in supabase_migrations.schema_migrations
#   2. writes SUPABASE_SERVICE_ROLE_KEY into apps/argus/.env.local (never printed)
#   3. sets the Auth site URL and redirect allow-list for local dev
#   4. runs the RLS negative check (supabase/tests/rls_check.sql), which always rolls back
#
# Usage: scripts/supabase-setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/apps/argus/.env.local"
API="https://api.supabase.com/v1"
SITE_URL="${ARGUS_SITE_URL:-http://localhost:3050}"

envval() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }

TOKEN="$(envval SUPABASE_ACCESS_TOKEN || true)"
SUPA_URL="$(envval NEXT_PUBLIC_SUPABASE_URL || true)"
REF="$(sed -E 's#https://([a-z0-9]+)\.supabase\.co.*#\1#' <<<"$SUPA_URL")"

[[ -n "$TOKEN" ]] || { echo "SUPABASE_ACCESS_TOKEN is missing in $ENV_FILE"; exit 1; }
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || { echo "Could not read the project ref from NEXT_PUBLIC_SUPABASE_URL"; exit 1; }

call() { # method path [json-body-file]
  local out code
  out="$(mktemp)"
  if [[ $# -ge 3 ]]; then
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$1" "$API$2" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data-binary "@$3")
  else
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$1" "$API$2" -H "Authorization: Bearer $TOKEN")
  fi
  if [[ "$code" -ge 300 ]]; then
    echo "  HTTP $code on $1 $2: $(head -c 400 "$out")" >&2
    rm -f "$out"; return 1
  fi
  cat "$out"; rm -f "$out"
}

sql() { # run one SQL string, print the JSON result
  local body; body="$(mktemp)"
  python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' >"$body"
  call POST "/projects/$REF/database/query" "$body"; local rc=$?; rm -f "$body"; return $rc
}

echo "Project $REF"
call GET "/projects/$REF" | jq -r '"  name: \(.name)  status: \(.status)  region: \(.region)"' \
  || { echo "This token cannot see project $REF. Create it while signed in as the project owner."; exit 1; }

echo "1. Migrations"
sql "create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);" >/dev/null
applied="$(sql 'select version from supabase_migrations.schema_migrations' | jq -r '.[].version')"
for f in "$ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$f" .sql)"; version="${base%%_*}"; name="${base#*_}"
  if grep -qx "$version" <<<"$applied"; then echo "  $base already applied"; continue; fi
  sql "$(cat "$f")" >/dev/null
  sql "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name') on conflict do nothing" >/dev/null
  echo "  $base applied"
done
echo "  tables: $(sql "select string_agg(tablename, ', ' order by tablename) as t from pg_tables where schemaname='public'" | jq -r '.[0].t')"

echo "2. Service role key"
key="$(call GET "/projects/$REF/api-keys?reveal=true" | jq -r '[.[] | select(.name=="service_role" or .type=="secret")][0].api_key // empty')"
if [[ -z "$key" ]]; then echo "  not returned by the API"; else
  python3 - "$ENV_FILE" "$key" <<'PY'
import sys
path, key = sys.argv[1], sys.argv[2]
lines = open(path).read().splitlines()
for i, l in enumerate(lines):
    if l.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        lines[i] = 'SUPABASE_SERVICE_ROLE_KEY=' + key
        break
else:
    lines.append('SUPABASE_SERVICE_ROLE_KEY=' + key)
open(path, 'w').write('\n'.join(lines) + '\n')
PY
  chmod 600 "$ENV_FILE"; echo "  written to apps/argus/.env.local (${#key} chars, not printed)"
fi

echo "3. Auth URLs"
body="$(mktemp)"
jq -n --arg site "$SITE_URL" '{site_url: $site, uri_allow_list: ($site + "/**")}' >"$body"
call PATCH "/projects/$REF/config/auth" "$body" | jq -r '"  site_url: \(.site_url)  allow-list: \(.uri_allow_list)"'
rm -f "$body"

echo "4. RLS negative check (rolled back)"
out="$(sql "$(cat "$ROOT/supabase/tests/rls_check.sql")" 2>&1 || true)"
result="$(sed 's/\\"/"/g' <<<"$out" | grep -o 'ARGUS_RLS_RESULT {[^}]*}' | head -1 | sed 's/ARGUS_RLS_RESULT //')"
if [[ -n "$result" ]]; then echo "  $result"; else echo "  unexpected output: ${out:0:300}"; fi
echo "Done."
