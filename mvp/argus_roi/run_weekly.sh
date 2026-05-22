#!/usr/bin/env bash
#
# Argus weekly run — the autonomous entrypoint.
#
# Runs the ROI engine with the LLM narrative, saves a dated memo, and
# (if ARGUS_SLACK_WEBHOOK_URL is set in .env) posts the summary to Slack.
# Designed to be driven by cron — see `make install-cron` note in README.
#
# Manual run:   ./run_weekly.sh
# Cron is what makes it autonomous; this script is what cron calls.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
REPORTS_DIR="$HERE/reports"
LOG_DIR="$HERE/logs"
STAMP="$(date +%Y-%m-%d)"
MEMO="$REPORTS_DIR/memo-$STAMP.md"
LOG="$LOG_DIR/run-$STAMP.log"

mkdir -p "$REPORTS_DIR" "$LOG_DIR"

# psql peer auth needs the right unix user; cron runs as the installing user.
export ARGUS_PG_USER="${ARGUS_PG_USER:-$(whoami)}"

{
  echo "=== Argus weekly run @ $(date -Is) ==="
  cd "$HERE"
  python3 engine.py --llm --out "$MEMO" --json "$REPORTS_DIR/findings-$STAMP.json"
  echo "memo written: $MEMO"

  # --- optional delivery to Slack ---
  WEBHOOK="$(grep -E '^ARGUS_SLACK_WEBHOOK_URL=' "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d ' ' || true)"
  if [ -n "${WEBHOOK:-}" ]; then
    # post the first ~40 lines (bottom-line + table) as a code block
    SUMMARY="$(sed -n '1,40p' "$MEMO" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
    curl -s -X POST -H 'Content-type: application/json' \
      --data "{\"text\": $SUMMARY}" "$WEBHOOK" >/dev/null \
      && echo "delivered to Slack" || echo "Slack delivery failed"
  else
    echo "no ARGUS_SLACK_WEBHOOK_URL set — memo saved locally only"
  fi
  echo "=== done @ $(date -Is) ==="
} >>"$LOG" 2>&1

echo "Argus run complete. Memo: $MEMO  Log: $LOG"
