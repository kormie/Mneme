# AGENTS.md

MNEME is a Personal AI OS memory system: four layers (sensory, working,
long-term, core), transitions as prompt graphs, digital twins as installed
partitions under a Core the human owns. The normative target is the spec
pack in `spec/` (mneme.spec/0.10). Not a chat app, not an agent society,
not any UI. Read `spec/README.txt` then `spec/mneme.brief.md` before doing
anything else. All relative paths in the brief resolve inside `spec/`.

If you have no tool or fetch access and were given only this file's
text — no way to open `spec/README.txt` or `spec/mneme.brief.md` — say so
explicitly and ask the human to supply this repo's root `CONTEXT.md`
before making any substantive claim about MNEME's model. Do not infer
the model from the short summary above; it is not a substitute for the
spec, and neither is `CONTEXT.md` itself (it is non-normative — see its
own header).

This file is the governance contract for every agent working in this
repo, regardless of vendor or tool surface: Claude Code, Codex, Cursor,
Gemini CLI, GitHub Copilot's coding agent, and tool-less browser chat
agents alike. Tool-specific configuration (hooks, subagent definitions,
skills) may live elsewhere per tool, but the rules below are the same
rules for everyone.

The steward is Kormie (@kormie). Agents implement; the human steers.

## Layout

- `spec/` — the canonical 0.10 pack, verbatim. **Read-only.**
- `spec.sha256` — byte manifest of the pack. **Read-only.**
- `scripts/verify-spec.sh` — proves the pack is intact. Run it often.
- `scripts/sync-lean.sh` — regenerates `proofs/Mneme/` from `spec/lean/`.
- `scripts/bootstrap.sh` — one-shot toolchain setup (pinned bun + elan,
  `bun install`). Paste it into a cloud agent's "setup script" field, or
  run locally; `--full` also runs `sync-lean.sh` and `lake build`.
  `scripts/install-elan.sh` is its elan-install step, factored out so CI
  and the bootstrap script share one definition.
- `proofs/` — Lake project wrapping the pack's Lean laws.
  `proofs/Mneme/` is generated and gitignored; never edit it.
- `helix/` — the ADR-013 slice. TypeScript on Bun 1.3+ (`bun test`);
  the Claude Code hook adapter stays dependency-free Node.

## Commands

```sh
./scripts/verify-spec.sh              # spec integrity (run before and after work)
cd helix && bun install && bun test   # Helix tests
cd helix && bun run typecheck         # strict tsc
bun helix/src/judge.ts                # untrusted judge over spec/inhabitants.md (see helix/JUDGE.md)
./scripts/sync-lean.sh                # refresh generated Lean sources
cd proofs && lake build               # check all laws + Regressions + KernelIR certificate (elan/Lean 4.33.1)
```

CI runs exactly these. A session is not done until all of them pass.

If you cannot execute these commands yourself (no shell access — for
example a browser chat agent), say so explicitly. Describe the intended
diff precisely enough that a human can run the block above themselves,
and never assert pass/fail on your own authority; that claim belongs to
whoever actually ran the commands.

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
   changing the Lean law set, or force-pushing anything. In Claude Code,
   `.claude/settings.json`'s `Edit`/`Write`-deny on `spec/**` and
   `spec.sha256`, plus the PreToolUse hook at
   `.claude/hooks/guard-spec-writes.sh` (which also denies Bash-shaped
   writes to those paths and denies `git push --force`/`-f`/
   `--force-with-lease`), are this list's only items with an automated
   backstop — and only in that one tool surface. Every other item, and
   this whole list on every other surface, is a social contract enforced
   by review and by you reading this file, not by code. Relatedly: never add `spec/` or `spec.sha256` to any AI
   tool's context-exclusion file (`.cursorignore`, `.geminiignore`,
   `.aiderignore`, or similar) — those files hide content from an
   agent's context, they are not a write-permission mechanism, and
   applying one to `spec/` would blind an agent to the canon it is
   required to consult rather than block a write to it.
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
  Steward accepted `KernelIR.certificate` (static only; axiom footnote
  as documented in helix/JUDGE.md).
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
- **SPEC ISSUE #2** — pg-adl guards `a6` (`score < tau`) and `a7`
  (`score >= tau`) in `spec/kernel.json` reference `tau`, which no IR
  surface declares: pg-adl's ingress is `ltm`, `fuel` only. A pure
  scheduler cannot evaluate these guards without inventing a threshold,
  so Helix fails closed (guard evaluation throws) and pg-adl is not
  schedulable from the IR alone. Proposed 0.11 fix (steward's call):
  declare `tau` in pg-adl ingress, or fold it into holdout's
  configuration — holdout is frozen, so the threshold is steward-held
  either way.
- **Toolchain note** — on lean4:v4.33.1, `decide` proofs over these
  predicates depend on `propext` (a core kernel axiom). "Axiom-free"
  in practice means: no `sorryAx`, no `Lean.ofReduceBool`
  (native_decide), no `Classical.choice`. The guard in
  `Regressions.lean` encodes exactly that. One nuance: any theorem
  whose statement mentions `WellFormed` additionally carries
  `Classical.choice` and `Quot.sound` through the toolchain's
  `String.Slice` machinery referenced by `versioned` (v4.33.1
  `String.take`) — from the String library's definitions, not from the
  tactic. The guard in `proofs/KernelIR.lean` therefore admits exactly
  `[propext, Classical.choice, Quot.sound]` while still refusing
  `sorryAx` and `Lean.ofReduceBool`.

## Importing a new pack (steward-initiated only)

Only when Kormie hands over a new versioned zip:

1. Replace the entire `spec/` directory wholesale. Never merge.
2. Regenerate the manifest:
   `find spec -type f | LC_ALL=C sort | xargs sha256sum > spec.sha256`
3. Single commit: `spec: import mneme.spec/0.X pack (verbatim)`.
4. Rewire bridges (Negatives import, Regressions) and update this file's
   version references in a follow-up commit.
5. Regenerate `CONTEXT.md` from the newly imported `spec/` in that same
   follow-up commit — never let `CONTEXT.md` drift out of sync with
   `spec/`, and never hand-edit it instead of regenerating it.

## Conventions

- Conventional-ish commits: `helix:`, `proofs:`, `spec:`, `ci:`, `docs:`.
- Small, reviewable changes. Tests accompany behavior.
- Never commit generated dirs (`proofs/Mneme/`, `node_modules/`,
  `.lake/`).
- Canadian spelling in prose.
