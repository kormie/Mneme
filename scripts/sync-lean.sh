#!/usr/bin/env bash
# Regenerate proofs/Mneme/ from spec/lean/. The copies are build artifacts
# (gitignored); spec/lean/ is the only source of truth. Run before `lake build`.
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/verify-spec.sh

rm -rf proofs/Mneme
mkdir -p proofs/Mneme
cp spec/lean/*.lean proofs/Mneme/

echo "OK: proofs/Mneme/ synced from spec/lean/ ($(ls proofs/Mneme | wc -l | tr -d ' ') modules)"
