import Base
import ./Trace.bend as T

# Port of spec/lean/Negatives.lean. The attack traces (ADR-014); each must stay
# red under its predicate. The ghost-edge attack needs the kernel types and
# arrives with them.

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
