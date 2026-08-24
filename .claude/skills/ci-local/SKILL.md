---
name: ci-local
description: Runs MNEME's three CI jobs locally, in the same order as .github/workflows/ci.yml, stopping at the first failure and naming the CI job it corresponds to. Use before opening a PR, after making changes under spec/, helix/, or proofs/, or when asked to "run CI locally", "check CI will pass", or "verify the pack, helix, and proofs".
---

# CI, locally

Mirrors `.github/workflows/ci.yml` exactly: three jobs, run in order, each a
prerequisite for the ones after it. Stop at the first failure — do not run
later jobs once one fails, and do not "fix" the failure by editing anything
under `spec/` (read-only canon, AGENTS.md law #1).

## Steps

Run each block from the repo root unless noted. If a command fails, stop
immediately, report the failing command's output, and name the job below —
do not proceed to the next step.

1. **`spec` job** (CI job name: `spec integrity`)

   ```sh
   ./scripts/verify-spec.sh
   ```

   Failure here means `spec/` has drifted from `spec.sha256`. Do not touch
   `spec/` or `spec.sha256` to fix it — report the drift and stop; only the
   steward resolves it (see the `import-spec-pack` skill, and only when the
   human has said they are the steward). `spec/` is read-only canon
   (AGENTS.md law #1).

2. **`helix` job** (CI job name: `helix`)

   ```sh
   cd helix
   bun install --frozen-lockfile
   bun run typecheck
   bun test
   bun run judge
   ```

   Run the four commands in order; stop at the first that fails and report
   which of `bun install`, `typecheck`, `test`, or `judge` failed. `bun run
   judge` is untrusted (ADR-008) — "judge fail=0" is progress, not a
   certificate; see `helix/JUDGE.md`.

3. **`proofs` job** (CI job name: `lean laws`)

   ```sh
   ./scripts/sync-lean.sh
   cd proofs
   lake build
   ```

   `sync-lean.sh` regenerates `proofs/Mneme/` from `spec/lean/` (and itself
   re-runs `verify-spec.sh` first). `lake build` checks every law,
   `Regressions.lean`, and the `KernelIR.certificate` axiom guard. Requires
   elan/Lean 4.33.1 on `PATH`.

## When all three pass

Report success per job (`spec integrity`, `helix`, `lean laws`) — this is
"CI would pass locally," not a certificate. It does not upgrade anything's
status on the brief's §13 ladder (judged / certified static / certified
runtime); it only means the same commands CI runs also succeeded here.
