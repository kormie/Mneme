import Mneme.Kernel
import Mneme.Trace

/-!
# Regression bridge for `Mneme.Negatives` (ADR-014)

SPEC ISSUE #1 (mneme.spec/0.10): `spec/lean/Negatives.lean` line 55
(`theorem attacksRed : AttacksRed := by decide`) does not compile.
`AttacksRed` is a `Prop` wrapped in a semireducible `def`, so `decide`
cannot synthesize `Decidable AttacksRed`. The five individual theorems
in that file are fine; only the one-shot conjunction fails.

This module is the bridge until the steward ships 0.11. It restates the
attack traces byte-for-byte and proves each red, plus the conjunction,
axiom-free. When 0.11 fixes the pack theorem (e.g. `abbrev AttacksRed`
or `by unfold AttacksRed; decide`):
  1. re-add `import Mneme.Negatives` to `proofs/Mneme.lean`
  2. delete this file and its `lean_lib` entry in `lakefile.toml`

This file is NOT the artifact of record. `spec/lean/Negatives.lean`
remains canonical (ADR-014). Do not extend this file with new laws.
-/

namespace Regressions
open Mneme

/-- Byte-parity with `Mneme.emptyKernel` in the pack. -/
def emptyKernel : Kernel :=
  { spec := "mneme.spec/0.9"
    layers := []
    graphs := []
    twins := []
    frozen := [] }

/-- Silent install: twin.install with no steward.ack. -/
def silentInstall : List Event :=
  [.twinInstall "demo-soma"]

theorem silentInstall_red : installRequiresAckB silentInstall = false := by decide

/-- Ack replay: one ack, two installs. -/
def ackReplay : List Event :=
  [.stewardAck "demo-soma", .twinInstall "demo-soma", .twinInstall "demo-soma"]

theorem ackReplay_red : installRequiresAckB ackReplay = false := by decide

/-- Permit amortized over two writes. -/
def amortizedPermit : List Event :=
  [.corePermit, .storeWrite "ltm" none, .storeWrite "lineage" none]

theorem amortizedPermit_red : commitAfterPermitB amortizedPermit = false := by decide

/-- Ghost edge: edgeFire naming an id absent from the kernel. -/
theorem ghostEdge_red : mentionsExist emptyKernel (.edgeFire "zz9") = false := by decide

/-- Inbox exemption is not a free LTM write. -/
def auditDoesNotConsume : List Event :=
  [.storeWrite "audit.inbox" none, .storeWrite "ltm" none]

theorem auditDoesNotConsume_red : commitAfterPermitB auditDoesNotConsume = false := by decide

/-- The conjunction `Mneme.Negatives.AttacksRed` spells out, kept red. -/
theorem attacksRed :
    installRequiresAckB silentInstall = false ∧
    installRequiresAckB ackReplay = false ∧
    commitAfterPermitB amortizedPermit = false ∧
    mentionsExist emptyKernel (.edgeFire "zz9") = false ∧
    commitAfterPermitB auditDoesNotConsume = false := by
  exact ⟨by decide, by decide, by decide, by decide, by decide⟩

/- Build-time axiom guard (ADR-014: `native_decide` is not the artifact;
    `by decide` is). On lean4:v4.33.1, `decide` proofs over these predicates
    carry `propext` — a core kernel axiom, acceptable. The guard exists to
    fail the build if `sorryAx`, `Lean.ofReduceBool` (native_decide), or
    `Classical.choice` ever appear. If a toolchain bump changes the exact
    message, update the docstring only after confirming the axiom list is
    still clean. -/
/-- info: 'Regressions.attacksRed' depends on axioms: [propext] -/
#guard_msgs in #print axioms attacksRed

end Regressions
