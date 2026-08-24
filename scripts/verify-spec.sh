#!/usr/bin/env bash
# Verify the spec/ pack is byte-identical to mneme.spec/0.10 as imported.
# Prompt bytes bind bodyHash (ADR-015). A one-character drift is a spec violation.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum --check --quiet spec.sha256
else
  shasum -a 256 --check --quiet spec.sha256
fi

# Catch additions/deletions, not just modifications.
expected=$(wc -l < spec.sha256 | tr -d ' ')
actual=$(find spec -type f | wc -l | tr -d ' ')
if [ "$expected" != "$actual" ]; then
  echo "FAIL: spec/ has $actual files, manifest expects $expected" >&2
  exit 1
fi

echo "OK: spec/ intact (mneme.spec/0.10, $actual files)"
