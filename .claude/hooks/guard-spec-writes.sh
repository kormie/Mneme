#!/usr/bin/env bash
# PreToolUse hook, matcher "Bash".
#
# Reads the PreToolUse JSON payload from stdin (see docs/hooks.md,
# "PreToolUse Input"): {"tool_name": "Bash", "tool_input": {"command": "..."}}.
# Pattern-matches tool_input.command for write-shaped Bash operations
# targeting spec/ or spec.sha256 (AGENTS.md law #1: read-only canon), and
# for any git push combined with --force/-f/--force-with-lease (AGENTS.md
# law #4: steward gate). On a match, denies the tool call via
# hookSpecificOutput.permissionDecision:"deny" (docs/hooks.md, "PreToolUse
# Decision Control") — the documented mechanism for blocking one specific
# tool call in place of the normal permission system.
#
# On no match: exit 0 with no output, so the normal permission flow (the
# allow/deny/ask rules in settings.json, or a user prompt) proceeds
# untouched. This hook never allows or asks; it only ever denies or gets
# out of the way.
#
# Conservative by design: false negatives (an exotic write pattern this
# script misses) are acceptable; false positives (blocking an unrelated
# command) are not. Keep additions here narrowly targeted.
#
# Known, accepted false negative: writes performed inside an interpreter
# one-liner (`python3 -c "open('spec/x','w')"`, `node -e "..."`, `ruby -e
# "..."`) are not caught. Parsing arbitrary embedded-language source to
# find a file write is a different, much harder problem than pattern-
# matching a shell command line, and this hook does not attempt it.
#
# By design, there is no bypass flag or environment variable that lets a
# command through anyway — including for the steward's own pack-import
# (see AGENTS.md "Importing a new pack" and the import-spec-pack skill).
# The agent's job when one of those commands is denied is to say so and
# have the human run it themselves, outside this hook's reach, never to
# look for a way around the denial.
set -u

input="$(cat)"

# jq is required to safely extract tool_input.command from arbitrary JSON
# (handles escaping correctly). If it is unavailable, fail open: getting
# out of the way of an unrelated command is safer than guessing at a
# hand-rolled JSON parse and blocking (or corrupting) something innocuous.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

command_str="$(printf '%s' "$input" | command jq -r '.tool_input.command // empty' 2>/dev/null)"

if [ -z "$command_str" ]; then
  exit 0
fi

deny() {
  local reason="$1"
  command jq -n --arg reason "$reason" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
  exit 0
}

# A path token referencing the spec pack: spec/<anything> or the exact
# manifest file spec.sha256. \b keeps "myspec/" or "somespec.sha256" from
# matching while still matching bare, relative, dotted, and absolute paths
# (a "/" is a non-word boundary too, so ".../Mneme/spec/x" still matches).
spec_target='\b(spec/|spec\.sha256)'

# The bare directory itself, with no trailing slash: `rm -rf spec`,
# `mv spec spec.old`, `git rm -r spec`. Requires "spec" to be a whole
# path segment (bounded by start/end/space/slash) so it does NOT match
# "tray.spec.ts" (bounded by dots) or "verify-spec.sh" (bounded by a
# hyphen) — both are real files in this repo and must never trip this.
spec_bare='(^|[[:space:]/])spec([[:space:]/]|$)'

# Either form: a spec/... path, spec.sha256, or the bare directory.
spec_any="(${spec_target}|${spec_bare})"

is_spec_write=0

# Redirection: `>` or `>>` (not part of a `2>&1`-style descriptor) with a
# spec/ or spec.sha256 target somewhere before the next command separator.
if printf '%s' "$command_str" | grep -Eq "(^|[^0-9])>>?[^&|;]*${spec_target}"; then
  is_spec_write=1
fi

# tee ... spec/... (tee writes to its file args regardless of -a)
if printf '%s' "$command_str" | grep -Eq "\\btee\\b[^&|;]*${spec_target}"; then
  is_spec_write=1
fi

# sed -i ... spec/...  (in-place edit)
if printf '%s' "$command_str" | grep -Eq '\bsed\b[^&|;]*-i' \
  && printf '%s' "$command_str" | grep -Eq "$spec_target"; then
  is_spec_write=1
fi

# perl -i ... spec/...  (in-place edit)
if printf '%s' "$command_str" | grep -Eq '\bperl\b[^&|;]*-i' \
  && printf '%s' "$command_str" | grep -Eq "$spec_target"; then
  is_spec_write=1
fi

# cp/mv/rm/rsync/unzip with a spec/, spec.sha256, or bare-`spec` target
# anywhere in the arguments — catches both `rm -rf spec/` (existing
# spec_target) and `rm -rf spec` (bare, no trailing slash).
if printf '%s' "$command_str" | grep -Eq "\\b(cp|mv|rm|rsync|unzip)\\b[^&|;]*${spec_any}"; then
  is_spec_write=1
fi

# git rm, same bare-or-slash target
if printf '%s' "$command_str" | grep -Eq '\bgit[[:space:]]+rm\b[^&|;]*' \
  && printf '%s' "$command_str" | grep -Eq "$spec_any"; then
  is_spec_write=1
fi

# git apply, when the command line also references spec/ or spec.sha256
# (a patch could add/modify/delete files there)
if printf '%s' "$command_str" | grep -Eq '\bgit[[:space:]]+apply\b' \
  && printf '%s' "$command_str" | grep -Eq "$spec_target"; then
  is_spec_write=1
fi

# git checkout <ref> -- spec/...  (restores spec/ from another ref)
if printf '%s' "$command_str" | grep -Eq "\\bgit[[:space:]]+checkout\\b[^&|;]*${spec_target}"; then
  is_spec_write=1
fi

# dd of=spec* (or of='spec...'/of="spec...")
if printf '%s' "$command_str" | grep -Eq '\bdd\b[^&|;]*\bof=["'"'"']?spec'; then
  is_spec_write=1
fi

if [ "$is_spec_write" -eq 1 ]; then
  deny "spec/ is read-only canon (AGENTS.md law) — stop and ask Kormie"
fi

# Force-push, any target — not just spec/ (AGENTS.md law #4: steward gate
# on force-pushing anything).
if printf '%s' "$command_str" | grep -Eq '\bgit[[:space:]]+push\b'; then
  if printf '%s' "$command_str" | grep -Eq '(^|[[:space:]])(--force(-with-lease)?|-f)([[:space:]]|$)'; then
    deny "force-push requires steward sign-off (AGENTS.md law) — stop and ask Kormie"
  fi
fi

exit 0
