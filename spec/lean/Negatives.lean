import Mneme.Kernel
import Mneme.Trace

namespace Mneme

/-!
Regression suite (ADR-014). Each attack must stay *red* under `decide`.
A law change that turns any of these green is a silent-install class regression.

These traces do not require Helix. They are the generic target.
-/

def emptyKernel : Kernel :=
  { spec := "mneme.spec/0.9"
    layers := []
    graphs := []
    twins := []
    frozen := [] }

/-- Silent install: twin.install with no steward.ack. 0.8 waved this through. -/
def silentInstall : List Event :=
  [.twinInstall "demo-soma"]

theorem silentInstall_red : installRequiresAckB silentInstall = false := by decide

/-- Ack replay: one ack, two installs. 0.8 waved this through. -/
def ackReplay : List Event :=
  [.stewardAck "demo-soma", .twinInstall "demo-soma", .twinInstall "demo-soma"]

theorem ackReplay_red : installRequiresAckB ackReplay = false := by decide

/-- Permit amortized over two writes. 0.8 waved this through. -/
def amortizedPermit : List Event :=
  [.corePermit, .storeWrite "ltm" none, .storeWrite "lineage" none]

theorem amortizedPermit_red : commitAfterPermitB amortizedPermit = false := by decide

/-- Ghost edge. 0.8 ValidTrace ignored edgeFire. -/
theorem ghostEdge_red : mentionsExist emptyKernel (.edgeFire "zz9") = false := by decide

/-- Inbox exemption is not a free LTM write. -/
def auditDoesNotConsume : List Event :=
  [.storeWrite "audit.inbox" none, .storeWrite "ltm" none]

theorem auditDoesNotConsume_red : commitAfterPermitB auditDoesNotConsume = false := by decide

/-- Conjunction the TypeScript regression runner must keep red. -/
def AttacksRed : Prop :=
  installRequiresAckB silentInstall = false ∧
  installRequiresAckB ackReplay = false ∧
  commitAfterPermitB amortizedPermit = false ∧
  mentionsExist emptyKernel (.edgeFire "zz9") = false ∧
  commitAfterPermitB auditDoesNotConsume = false

theorem attacksRed : AttacksRed := by decide

end Mneme

