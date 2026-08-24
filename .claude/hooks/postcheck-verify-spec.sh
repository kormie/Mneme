#!/usr/bin/env bash
# PostToolUse hook, matcher "Edit|Write|Bash".
#
# Runs ./scripts/verify-spec.sh after any Edit, Write, or Bash tool call
# and, on a non-zero exit, signals a block via the documented PostToolUse
# JSON decision control (docs/hooks.md, "PostToolUse Decision Control":
# {"decision": "block", "reason": "..."}) so Claude is told immediately —
# the tool has already run by the time PostToolUse fires, so this cannot
# undo anything; it can only surface the failure per AGENTS.md law #1
# ("spec/ is read-only canon... a one-character diff is a spec
# violation") rather than let it go unnoticed.
#
# This hook does not read tool_input/tool_output from stdin: it runs the
# same integrity check unconditionally on every matched tool call, which
# is what "run before and after work" (AGENTS.md) calls for.
set -u

# Consume and discard stdin so Claude Code's hook runner never blocks on
# an unread pipe.
cat >/dev/null 2>&1 || true

# Resolve the repo root. $CLAUDE_PROJECT_DIR is documented (docs/hooks.md,
# "Project-Specific Hook Scripts") as available whenever Claude Code
# spawns the hook command, and is the reliable way to find the project
# root regardless of Claude's current working directory. Fall back to a
# path relative to this script's own location (mirroring how
# scripts/verify-spec.sh finds its own root) if it is ever unset, e.g.
# when someone runs this hook by hand outside a Claude Code session.
if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  repo_root="$CLAUDE_PROJECT_DIR"
else
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
  repo_root="$(cd "$script_dir/../.." >/dev/null 2>&1 && pwd)"
fi

verify_script="$repo_root/scripts/verify-spec.sh"

if [ ! -x "$verify_script" ]; then
  # Nothing to check against; don't block on missing tooling.
  exit 0
fi

verify_output="$("$verify_script" 2>&1)"
verify_status=$?

if [ "$verify_status" -ne 0 ]; then
  reason="spec/ integrity check failed — do not attempt to auto-fix; report to Kormie per AGENTS.md law #1.

$verify_output"
  command jq -n --arg reason "$reason" '{decision: "block", reason: $reason}' 2>/dev/null \
    || printf '{"decision":"block","reason":"spec/ integrity check failed — do not attempt to auto-fix; report to Kormie per AGENTS.md law #1."}'
  exit 0
fi

exit 0
