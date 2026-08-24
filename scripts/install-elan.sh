#!/usr/bin/env bash
# Install elan (the Lean toolchain manager) if it isn't already on PATH.
# Shared by CI (proofs job) and scripts/bootstrap.sh so there is one
# definition of "how to get elan".
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v elan >/dev/null 2>&1; then
  echo "OK: elan already installed ($(command -v elan))"
  exit 0
fi

curl -sSf https://elan.lean-lang.org/elan-init.sh | sh -s -- -y --default-toolchain none

# Make elan visible to the rest of this shell/job.
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$HOME/.elan/bin" >>"$GITHUB_PATH"
else
  export PATH="$HOME/.elan/bin:$PATH"
fi

echo "OK: elan installed ($HOME/.elan/bin)"
