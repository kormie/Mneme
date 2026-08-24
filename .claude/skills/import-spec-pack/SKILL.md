---
name: import-spec-pack
description: Codifies AGENTS.md's (formerly CLAUDE.md's) "Importing a new pack" steps verbatim for replacing spec/ with a new versioned mneme.spec pack. STEWARD-INITIATED ONLY — never invoke speculatively, never as part of routine spec-adjacent work, and never on your own initiative just because spec/ looks stale. Invoke only when the human has explicitly stated they are the steward (Kormie) handing over a new versioned pack.
---

# Importing a new spec pack

**Do not use this skill unless the human has explicitly said they are the
steward handing over a new versioned pack.** Reading spec/, noticing it is
out of date, seeing a mismatch against the brief, or being asked to
"update the spec" in general terms are not invocations of this skill —
those are, per AGENTS.md, reported to Kormie, not acted on. `spec/` is
read-only canon (law #1); this skill exists only to perform the one
steward-authorized exception, on explicit instruction, never speculatively.

If you are unsure whether the human is acting as steward right now, stop
and ask before doing anything below.

This governance text currently lives in `AGENTS.md`'s "Importing a new
pack (steward-initiated only)" section (it moved there from `CLAUDE.md`,
which now just `@AGENTS.md`-includes it) — check that file directly before
relying on this skill's copy, in case it has moved or changed again.

## Steps 1–2 run by the human, not by you

Steps 1 and 2 below write to `spec/` and `spec.sha256`. If this session
is running under Claude Code, `.claude/hooks/guard-spec-writes.sh` will
(correctly) deny you if you try to run them yourself via the Bash tool —
there is no bypass, and none should be added. Your job for those two
steps is to print the exact commands and have Kormie run them himself in
a terminal outside this session. Steps 3–6 (commit, rewiring, CONTEXT.md
regeneration, re-diffing the gate list) can proceed normally once 1–2
are done, since they don't touch `spec/` or `spec.sha256` directly.

## Steps (verbatim from AGENTS.md's "Importing a new pack")

Only when Kormie hands over a new versioned zip:

1. **Replace the entire `spec/` directory wholesale. Never merge.**

2. **Regenerate the manifest:**

   ```sh
   find spec -type f | LC_ALL=C sort | xargs sha256sum > spec.sha256
   ```

3. **Single commit:** `spec: import mneme.spec/0.X pack (verbatim)`.

4. **Rewire bridges (Negatives import, Regressions) and update this
   file's version references in a follow-up commit.**

5. **Regenerate `CONTEXT.md` from the newly imported `spec/` in that same
   follow-up commit** — never let `CONTEXT.md` drift out of sync with
   `spec/`, and never hand-edit it instead of regenerating it.

## Additional verification (after step 5, still in the follow-up commit)

This is not in AGENTS.md's own five steps, but follows from them and
should be done before calling the import complete:

6. **Re-diff the steward-gate and frozen-surface lists** in AGENTS.md's
   "Steward gates" bullet — currently: capability tokens (cap.mint/revoke),
   twin installs, the frozen surfaces (validate, holdout, cut-class,
   structural, archive, audit-heuristics, sample-clean), Certificate /
   RuntimeCertificate acceptance, the Lean law set, force-pushes — against
   the newly imported `spec/mneme.brief.md`. A new pack can rename, add, or
   drop a frozen surface; if the wording no longer matches, update
   AGENTS.md's list in the follow-up commit rather than leaving it stale.

## Reminders while doing this

- `spec/` is replaced wholesale — do not hand-edit individual files inside
  it to "reconcile" with the old pack (AGENTS.md law #2: do not reconcile
  against 0.6–0.9; the new pack is the kernel).
- `proofs/Mneme/` is generated (gitignored) — do not touch it directly;
  `./scripts/sync-lean.sh` regenerates it from the new `spec/lean/`.
- Negatives stay red (law #3): after rewiring, `proofs/Regressions.lean`
  must still fail the five attack traces' predicates. A new pack that
  turns one green is a regression to flag to the steward, not to patch
  around.
- Run `./scripts/verify-spec.sh` after step 2 and the `ci-local` skill's
  full sequence after step 5, to confirm the new pack is internally
  consistent before treating the import as done.
