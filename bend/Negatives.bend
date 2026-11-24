import Base
import ./Kernel.bend as K
import ./Trace.bend as T

# Port of spec/lean/Negatives.lean. The attack traces (ADR-014); each must stay
# red under its predicate.

# Silent install: twin.install with no steward.ack.
def silentInstall() -> List<&2, T.TraceEvent>:
  [T.TwinInstall{"demo-soma"}]

# Ack replay: one ack, two installs.
def ackReplay() -> List<&2, T.TraceEvent>:
  [T.StewardAck{"demo-soma"}, T.TwinInstall{"demo-soma"}, T.TwinInstall{"demo-soma"}]

# Permit amortized over two writes.
def amortizedPermit() -> List<&2, T.TraceEvent>:
  [T.CorePermit{}, T.StoreWrite{"ltm", None{}}, T.StoreWrite{"lineage", None{}}]

# Inbox exemption is not a free LTM write.
def auditDoesNotConsume() -> List<&2, T.TraceEvent>:
  [T.StoreWrite{"audit.inbox", None{}}, T.StoreWrite{"ltm", None{}}]

# Lean `emptyKernel` (its spec string says 0.9 in the 0.10 pack; kept verbatim).
def emptyKernel() -> K.Kernel:
  K.Kernel{"mneme.spec/0.9", [], [], [], []}

# Ghost edge: an edgeFire naming an edge no graph declares.
def ghostEdge() -> T.TraceEvent:
  T.EdgeFire{"zz9"}

# Lean `AttacksRed`: the conjunction the regression runner must keep red.
def attacksRed() -> Bool:
  (
    Bool.not(T.installRequiresAck(silentInstall())) &&
    Bool.not(T.installRequiresAck(ackReplay())) &&
    Bool.not(T.commitAfterPermit(amortizedPermit())) &&
    Bool.not(T.mentionsExist(emptyKernel(), ghostEdge())) &&
    Bool.not(T.commitAfterPermit(auditDoesNotConsume()))
  )
