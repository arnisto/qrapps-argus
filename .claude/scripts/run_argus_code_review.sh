#!/usr/bin/env bash
# PostToolUse wrapper for the Argus code-review script.
# Reads the Edit/Write tool payload from stdin, runs the reviewer on the
# affected .py file, and (if there are findings) emits a hook-protocol
# JSON object with the findings as `additionalContext` so the next turn
# sees them. Always exits 0 — advisory only, never blocks.

set +e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PAYLOAD="$(cat)"

f=$(printf '%s' "$PAYLOAD" | jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null)
case "$f" in
  *.py) ;;
  *)    exit 0 ;;
esac

# Skip generated/third-party/console roots (the reviewer skips them too,
# but bailing early avoids spawning python at all).
case "$f" in
  */console/*|*/node_modules/*|*/.venv/*|*/__pycache__/*|/tmp/*) exit 0 ;;
esac

out="$(python3 "$REPO_ROOT/.claude/scripts/argus_code_review.py" "$f" 2>&1)"
[ -z "$out" ] && exit 0

jq -nc --arg ctx "$out" '
  { hookSpecificOutput:
      { hookEventName: "PostToolUse",
        additionalContext: $ctx } }
'
exit 0
