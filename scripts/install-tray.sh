#!/usr/bin/env bash
# Install the MNEME desk tray for one person: non-interactive and
# idempotent, so a fleet tool (MDM) can run it as the user, and a person
# can run it again any time. It installs bun if missing, the pinned
# helix dependencies, verifies the spec pack, and — only with --hook —
# merges the Claude Code hook into that user's ~/.claude/settings.json
# (a backup of the previous file is kept). It never touches ~/.mneme,
# the store, or the Core: memory stays the person's, and nothing becomes
# memory except by a drain they run.
#
#   ./scripts/install-tray.sh          # bun + deps + spec check, print the hook block
#   ./scripts/install-tray.sh --hook   # also install the hook into ~/.claude/settings.json
#
# The Lean toolchain is not needed on a laptop and is not installed here;
# scripts/bootstrap.sh is the developer/CI bootstrap that adds it.
set -euo pipefail
cd "$(dirname "$0")/.."

hook=false
for arg in "$@"; do
  case "$arg" in
    --hook) hook=true ;;
    *) echo "install-tray: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# bun's installer needs unzip; fail early with a usable message.
if ! command -v unzip >/dev/null 2>&1; then
  echo "FAIL: unzip is required to install bun (https://bun.sh/install) but was not found on PATH." >&2
  exit 1
fi

# bun at least the pinned version (helix/.bun-version), never downgraded.
pinned=$(tr -d '[:space:]' <helix/.bun-version)
installed=""
if command -v bun >/dev/null 2>&1; then installed=$(bun --version); fi
older() { [ "$1" = "$2" ] && return 1; [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]; }
if [ -z "$installed" ] || older "$installed" "$pinned"; then
  echo "Installing bun $pinned (found: ${installed:-none})..."
  curl -fsSL https://bun.sh/install | bash -s "bun-v$pinned"
  export PATH="$HOME/.bun/bin:$PATH"
else
  echo "OK: bun $installed already satisfies >=$pinned"
fi

./scripts/verify-spec.sh
(cd helix && bun install --frozen-lockfile)

if [ "$hook" = true ]; then
  (cd helix && bun src/hook-install.ts --write)
else
  echo "hook not installed (pass --hook to merge it into ~/.claude/settings.json); the block would be:"
  (cd helix && bun src/tray.ts --hook-snippet)
fi

cat <<-EOF
	READY: mneme desk tray installed for $(id -un)
	  bun:   $(bun --version)
	  hook:  $hook
	  next:  cd helix && bun run status
EOF
