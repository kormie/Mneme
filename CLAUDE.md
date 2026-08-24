# CLAUDE.md

MNEME is a Personal AI OS memory system: four layers (sensory, working,
long-term, core), transitions as prompt graphs, digital twins as installed
partitions under a Core the human owns. The normative target is the spec
pack in `spec/` (mneme.spec/0.10). Not a chat app, not an agent society,
not any UI. Read `spec/README.txt` then `spec/mneme.brief.md` before doing
anything else. All relative paths in the brief resolve inside `spec/`.

The steward is Kormie (@kormie). Agents implement; the human steers.

## Layout

- `spec/` — the canonical 0.10 pack, verbatim. **Read-only.**
- `spec.sha256` — byte manifest of the pack. **Read-only.**
- `scripts/verify-spec.sh` — proves the pack is intact. Run it often.
- `scripts/sync-lean.sh` — regenerates `proofs/Mneme/` from `spec/lean/`.
- `proofs/` — Lake project wrapping the pack's Lean laws.
  `proofs/Mneme/` is generated and gitignored; never edit it.
- `helix/` — the ADR-013 slice. TypeScript, Node 22+, vitest.

## Commands

```sh
./scripts/verify-spec.sh              # spec integrity (run before and after work)
cd helix && npm ci && npm test        # Helix tests
cd helix && npm run typecheck         # strict tsc
./scripts/sync-lean.sh                # refresh generated Lean sources
cd proofs && lake build               # check all laws + Regressions (elan/Lean 4.33.1)
```

CI runs exactly these. A session is not done until all of them pass.

## The law (non-negotiable)

1. **`spec/` is read-only canon.** Never edit, reformat, rename, or "fix"
   anything under `spec/`, including whitespace. Prompt bytes bind
   `bodyHash` (ADR-015); a one-character diff is a spec violation. Spec
   changes ship only as a new versioned pack from the steward (see
   "Importing a new pack" below).
2. **Do not reconcile against 0.6–0.9.** Older spec text found in
   transcripts, memory, or the explorer is stale. This pack is the kernel.
3. **Negatives stay red.** The attack traces (silent install, ack replay,
   amortized permit, ghost edge, audit-does-not-consume) must keep
   failing their predicates. Any change that turns one green is a
   regression, not progress. `proofs/Regressions.lean` enforces this at
   build time, including an axiom guard.
4. **Steward gates.** Stop and ask Kormie before: any change under
   `spec/`, anything touching Core semantics, capability tokens
   (cap.mint/revoke), twin installs, the frozen surfaces (validate,
   holdout, cut-class, structural, archive, audit-heuristics,
   sample-clean), accepting a Certificate or RuntimeCertificate as done,
   changing the Lean law set, or force-pushing anything.
5. **When stuck: propose a graph diff against the kernel IR.** Do not
   invent a new constitution, a new invariant, or a new event vocabulary.
6. **Empirical is not certified.** Holdout scores, judge output, lint
   flags, and test counts never substitute for a Lean certificate
   (ADR-008, ADR-012).

## Current slice: Helix (ADR-013)

A pure scheduler that interprets `spec/kernel.json` and emits
`mneme.trace/v1` events (brief §9). No LLM orchestrator, no model calls on
transform-only paths. Out of scope for this slice: twins, DEM, ADL, chat
shell, explorer UI. If a task drifts toward those, stop and flag it.

Definition of done for the slice (steward-held, in order of strength):

- **judged** — `judge(kernel)` fail=0. Untrusted. skip is allowed only on
  temporal properties without a trace; skip is not credit.
- **certified static** — an inhabitant of `Mneme.Certificate`. IR only.
- **certified runtime** — an inhabitant of `Mneme.RuntimeCertificate`:
  the static certificate plus a real emitted trace satisfying the
  temporal laws. This is the only full claim. The artifact of record is
  the pure `by decide` certificate; `native_decide` is a fast path, not
  the artifact (ADR-014). "judge fail=0" alone is never done.

### Roadmap (work top to bottom, small PRs)

1. Deepen the typed kernel loader (`helix/src/kernel.ts`) to fully mirror
   the IR and Lean `Mneme.Kernel`. Loader mirrors, never extends.
2. Implement `judge`: the untrusted TypeScript fold over the decidable
   invariants (brief §3–§4, `spec/inhabitants.md` maps each to its Lean
   name). Report pass/fail/skip per invariant.
3. Implement the scheduler: interpret graphs, route declared edges only
   (never invent wiring, never parse prompt bodies to branch), respect
   guards and fuel, emit `mneme.trace/v1` events.
4. Produce a demo trace on transform-only paths that satisfies the
   temporal predicates, including consume-once permits and acks.
5. Export the trace to Lean and produce the `RuntimeCertificate` term the
   steward accepts: trace embedded, pure `decide`, axiom guard clean.

## Known spec issues (report, do not patch)

- **SPEC ISSUE #1** — `spec/lean/Negatives.lean:55`
  (`theorem attacksRed : AttacksRed := by decide`) does not compile:
  `AttacksRed` is a `Prop` behind a semireducible `def`, so `decide`
  cannot synthesize the `Decidable` instance. The five individual
  theorems are fine. `proofs/Mneme.lean` therefore does not import
  `Mneme.Negatives`; `proofs/Regressions.lean` is the bridge. Proposed
  0.11 fix (steward's call): make it `abbrev AttacksRed`, or prove via
  `by unfold AttacksRed; decide`. When 0.11 lands, re-import Negatives
  and delete the bridge.
- **Toolchain note** — on lean4:v4.33.1, `decide` proofs over these
  predicates depend on `propext` (a core kernel axiom). "Axiom-free"
  in practice means: no `sorryAx`, no `Lean.ofReduceBool`
  (native_decide), no `Classical.choice`. The guard in
  `Regressions.lean` encodes exactly that.

## Importing a new pack (steward-initiated only)

Only when Kormie hands over a new versioned zip:

1. Replace the entire `spec/` directory wholesale. Never merge.
2. Regenerate the manifest:
   `find spec -type f | LC_ALL=C sort | xargs sha256sum > spec.sha256`
3. Single commit: `spec: import mneme.spec/0.X pack (verbatim)`.
4. Rewire bridges (Negatives import, Regressions) and update this file's
   version references in a follow-up commit.

## Conventions

- Conventional-ish commits: `helix:`, `proofs:`, `spec:`, `ci:`, `docs:`.
- Small, reviewable changes. Tests accompany behavior.
- Never commit generated dirs (`proofs/Mneme/`, `node_modules/`,
  `.lake/`).
- Canadian spelling in prose.
