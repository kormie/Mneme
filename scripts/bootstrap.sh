#!/usr/bin/env bash
# One-shot toolchain bootstrap for MNEME. Paste this into a cloud agent's
# "setup script" field, or run locally as ./scripts/bootstrap.sh [--full].
#
# Fast path (default): verify the spec pack, install bun + elan if missing,
# install helix's pinned deps. Idempotent -- safe to re-run.
#
# --full: additionally pre-warms the Lean toolchain download (sync-lean +
# lake build) during setup instead of an agent's first interactive turn.
set -euo pipefail
cd "$(dirname "$0")/.."

full=false
if [ "${1:-}" = "--full" ]; then
  full=true
fi

# (a) bun's public installer (https://bun.sh/install) hard-requires unzip
# and fails with a cryptic error ("unzip is required to install bun") if
# it's missing. Fail fast here with an actionable message instead.
if ! command -v unzip >/dev/null 2>&1; then
  echo "FAIL: unzip is required to install bun (https://bun.sh/install) but was not found on PATH." >&2
  echo "      Install it first, e.g.: apt-get install -y unzip   (or) brew install unzip" >&2
  exit 1
fi

# (b) install bun if missing or older than the pin. The pin lives in
# helix/.bun-version (the same file CI's setup-bun step reads, and the
# same floor helix/package.json's "engines" field states) -- never
# hardcode the version here a second time. This is a >= check, not an
# exact match: a developer on a newer bun must never be silently
# downgraded to the pin.
pinned_bun_version=$(tr -d '[:space:]' <helix/.bun-version)
installed_bun_version=""
if command -v bun >/dev/null 2>&1; then
  installed_bun_version=$(bun --version)
fi

bun_version_lt() { # $1 < $2, via sort -V (GNU coreutils and macOS/BSD both support -V)
  [ "$1" = "$2" ] && return 1
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]
}

if [ -z "$installed_bun_version" ] || bun_version_lt "$installed_bun_version" "$pinned_bun_version"; then
  echo "Installing bun $pinned_bun_version (found: ${installed_bun_version:-none})..."
  curl -fsSL https://bun.sh/install | bash -s "bun-v$pinned_bun_version"
  export PATH="$HOME/.bun/bin:$PATH"
else
  echo "OK: bun $installed_bun_version already satisfies >=$pinned_bun_version"
fi

# (c) install elan/lake if missing. One shared definition with CI.
if ! command -v elan >/dev/null 2>&1 || ! command -v lake >/dev/null 2>&1; then
  ./scripts/install-elan.sh
  export PATH="$HOME/.elan/bin:$PATH"
else
  echo "OK: elan/lake already installed"
fi

# (d) verify the spec pack FIRST, before any step (sync-lean, lake build)
# that reads spec/ and could otherwise mask a drifted pack behind a
# seemingly successful build. This script never writes under spec/.
./scripts/verify-spec.sh

# (e) fast path stops here by default: install helix's pinned deps.
(cd helix && bun install --frozen-lockfile)

if [ "$full" = true ]; then
  # (f) --full: pre-warm the Lean toolchain download during setup instead
  # of an agent's first interactive turn. proofs/lake-manifest.json
  # declares zero external packages ("packages": []), so `lake build` has
  # nothing to fetch except the elan-managed toolchain itself -- there is
  # no dependency cache to warm beyond that.
  ./scripts/sync-lean.sh
  (cd proofs && lake build)
fi

# (g) ready summary.
cat <<-EOF
	READY: mneme toolchain bootstrapped
	  bun:  $(bun --version)
	  elan: $(command -v elan >/dev/null 2>&1 && echo present || echo missing)
	  spec: verified
	  helix deps: installed
	  proofs built: $full
EOF
