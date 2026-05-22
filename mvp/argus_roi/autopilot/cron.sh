#!/usr/bin/env bash
#
# Daily autonomous Argus run — what cron calls.
# Maps the DB, regenerates playbooks via the LLM, validates, sizes, and
# persists everything to Postgres + Redis. No files except a rolling log.
#
# Install (runs every day at 07:00):
#   ( crontab -l 2>/dev/null; \
#     echo "0 7 * * * $PWD/cron.sh >> $PWD/logs/cron.log 2>&1" ) | crontab -

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
mkdir -p logs

# peer auth needs the invoking unix user; docker must be on PATH for argus pg/redis
export ARGUS_PG_USER="${ARGUS_PG_USER:-$(whoami)}"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

TARGET="${1:-intigo}"
echo "===== Argus autopilot @ $(date -Is) target=$TARGET ====="
python3 autopilot.py --target "$TARGET" --n 8
echo "===== done @ $(date -Is) ====="
