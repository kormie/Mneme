## What

<!-- One-line summary of the change. -->

**Summary:**

**Roadmap step / ADR this advances:**
<!-- e.g. "Helix roadmap step 2 (judge)" or "ADR-013". See AGENTS.md / CLAUDE.md. -->

## Validation

Checklist mirrors AGENTS.md's (see also CLAUDE.md) CI-equivalent command
list. Run each command and paste its literal output underneath.

- [ ] `./scripts/verify-spec.sh`

  ```text
  <paste output>
  ```

- [ ] `cd helix && bun run typecheck && bun test && bun run judge`

  ```text
  <paste output>
  ```

- [ ] `./scripts/sync-lean.sh && cd proofs && lake build`

  ```text
  <paste output>
  ```

- [ ] `git diff --stat origin/main...HEAD -- spec spec.sha256` — must be
  **empty** unless this PR is a steward-initiated pack import

  ```text
  <paste output — expect nothing>
  ```

## Steward gate check

Per AGENTS.md / CLAUDE.md law #4 ("Steward gates"), check every box below
that applies to this PR.

**Any checked box means: stop. This needs Kormie's explicit sign-off, not
just routine review.**

- [ ] Touches `spec/` or `spec.sha256`
- [ ] Touches Core semantics
- [ ] Touches capability tokens (`cap.mint`, `cap.revoke`)
- [ ] Touches twin installs
- [ ] Touches a frozen surface (validate, holdout, cut-class, structural,
  archive, audit-heuristics, sample-clean)
- [ ] Treats a `Certificate` or `RuntimeCertificate` as done
- [ ] Changes the Lean law set
- [ ] Force-pushes anything

## Negatives

- [ ] `proofs/Regressions.lean`'s attack-trace pass/fail set is unchanged:
  the five negatives (silent install, ack replay, amortized permit, ghost
  edge, audit-does-not-consume) still fail their predicates. Still red.

---

judge fail=0 / test counts are not a certificate (ADR-008/012).
