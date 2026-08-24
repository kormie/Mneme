# The judge — untrusted, by design

`judge` is the TypeScript fold over every inhabitant in
`spec/inhabitants.md`, run against the kernel IR and (optionally) a
`mneme.trace/v1` file. It is untrusted (ADR-008): its mirrors of the Lean
predicates are handwritten TypeScript, and nothing checks them but tests.
Passing the judge is never a proof. The artifacts of record live in
`proofs/`: the static `Certificate` term in `KernelIR.lean` and the
attack regressions in `Regressions.lean`, both kernel-checked by Lean.

```sh
bun src/judge.ts                       # kernel fold + the five attack traces
bun src/judge.ts --trace traces/tray.json   # also judge a trace file
bun src/judge.ts --runtime             # attempt the RuntimeCertificate run
```

Each row prints the invariant id, its Lean name, its FORCE (the brief's
§3 MUST / §4 MUST NOT split), and pass/fail/skip.

## judged ≠ certified

The brief's §13 ladder, weakest to strongest:

1. **judged** — `judge(kernel)` has fail=0 on every decidable law.
   Untrusted TypeScript; behaviour, not proof. skip is allowed only on
   temporal properties when no trace exists, and skip is not credit.
2. **certified static** — an inhabitant of `Mneme.Certificate`:
   `KernelIR.certificate` in `proofs/KernelIR.lean`, the kernel IR
   projected into Lean and every conjunct of `Mneme.Laws` proved
   `by decide`. IR-certified only; says nothing about any runtime.
3. **certified runtime** — an inhabitant of `Mneme.RuntimeCertificate`:
   the static certificate plus a real emitted trace satisfying
   `Mneme.Trace.Temporal`. This is the only full claim, and this slice
   does not have it — see BLOCKED-RUNTIME below.

Judge output restates this in its footer. "judge fail=0" alone is never
done; empirical results (holdout scores, lint flags, test counts) never
substitute for a certificate.

## The tray trace is not a RuntimeCertificate

`bun src/tray.ts` emits a genuine scheduler trace, and the judge honours
it as far as it goes: on the fixture notes the safety laws pass —
`CommitAfterPermit` (one permit per write, audit.inbox exempt),
`AuditNotEffect`, `DenyImpliesInterrupt`, `TwinIdRequiresInstall`,
`InstallRequiresAck`, `ScheduleNonempty`, `ValidTrace`,
`ProposeNotInstall`. But `Mneme.Trace.Temporal` also demands
`HasClusterCut` and `HasArchiveSample`, and the tray path never runs
pg-adl or pg-dem, so both fail on that trace — correctly. Adding
`cluster.cut` or `archive.sample` events by hand would be a stuffed log,
not progress; the judge flags such a trace as "not a RuntimeCertificate
candidate" instead.

## Map of skip and fail

| Situation | Result |
| --- | --- |
| Decidable law, kernel fold | pass or fail; fail=0 required for "judged" |
| Temporal law, no trace given | skip ("no trace") — the only permitted skip |
| Temporal safety law, trace given | must pass; a fail flips the exit code |
| `HasClusterCut` / `HasArchiveSample`, tray trace | fail — liveness gap; blocks RuntimeCertificate only, exit code unaffected |
| Attack trace predicate goes green | fail — a regression, never progress |

Exit codes: `0` = judged (and, with `--trace`, no safety fail); `1` =
any decidable fail, attack regression, or trace safety fail. For
`--runtime`: `0` = the documented BLOCKED-RUNTIME outcome; `1` = the tau
guards unexpectedly evaluated, which means someone changed the spec —
stop and ask the steward.

## SPEC ISSUE #1 — the bundled attacksRed theorem

`spec/lean/Negatives.lean:55` (`theorem attacksRed : AttacksRed := by
decide`) does not compile: `AttacksRed` is a `Prop` behind a
semireducible `def`, so `decide` cannot synthesize its `Decidable`
instance. The five individual theorems are fine. The judge therefore
checks INV-ATTACKS-RED predicate-by-predicate over the five attack
traces (silent install, ack replay, amortized permit, ghost edge,
audit-does-not-consume), exactly as `proofs/Regressions.lean` proves
them in Lean. The proposed 0.11 fix is the steward's call.

## SPEC ISSUE #2 — tau, and BLOCKED-RUNTIME

pg-adl's guards `a6` (`score < tau`) and `a7` (`score >= tau`) reference
`tau`, which no IR surface declares: pg-adl's ingress is `ltm`, `fuel`
only. A pure scheduler cannot evaluate these guards without inventing a
threshold, so Helix fails closed — `evalGuard` throws — and pg-adl is
not schedulable from the IR alone.

`bun src/judge.ts --runtime` demonstrates this honestly: it drives
pg-adl through its declared abstraction path (sample → cluster →
cut-class → propose-abs → holdout, routing stand-ins only, no effect
events) and shows the scheduler failing closed on `a6`. Since pg-adl
owns `cluster.cut`, no trace can satisfy `HasClusterCut` without it, so
there is no `RuntimeCertificate` from this slice: the judge prints
**BLOCKED-RUNTIME** and stops. Neither patching `spec/`, nor inventing a
tau, nor emitting the missing events from a stub is an acceptable way
around this; the fix (declare `tau` in pg-adl ingress, or fold it into
holdout's frozen configuration) ships only as part of a 0.11 pack from
the steward.

A vacuous pass is fine where the law is conditional — a trace with no
`twin.install` satisfies `InstallRequiresAck` vacuously. A vacuous
`HasClusterCut` is not possible: it is an existence claim, and existence
demands the real run.

## The Lean side

- `proofs/KernelIR.lean` is generated by `cd helix && bun
  src/lean-export.ts` from `spec/kernel.json` and committed;
  `test/judge.spec.ts` fails if the committed file drifts from the
  generator. Never edit it by hand.
- Every conjunct is `by decide`. `kernel_wellFormed` uses `decide
  +kernel` because `versioned` compares `String.Slice`s (v4.33.1
  `String.take`), which the elaborator cannot reduce but the trusted
  kernel can; the proof term has the same shape either way, with no
  native code involved.
- The build-time axiom guard admits `propext` (what `decide` proofs
  carry on this toolchain) plus `Classical.choice` and `Quot.sound`,
  which enter through the toolchain's `String.Slice` machinery referenced
  by `wellFormedB` — from the String library's definitions, not from the
  tactic. `sorryAx` and `Lean.ofReduceBool` (native_decide) fail the
  build. The trace-law theorems in `Regressions.lean` stay at
  `[propext]`.
