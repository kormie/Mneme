import Base

# Spike: port of spec/lean/Trace.lean's `Event` and `installRequiresAckB`.
# Mirrors the Lean source; it never extends it (AGENTS.md, roadmap step 1).

# Trace.lean `Event`, constructor for constructor. `Option String` is
# `Maybe<&2, String>` so the whole type stays Data (reusable).
type TraceEvent is Data:
  NodeEnter{graph: String, node: String}
  NodeExit{graph: String, node: String}
  EdgeFire{edge: String}
  StoreRead{store: String, twin: Maybe<&2, String>}
  StoreWrite{store: String, twin: Maybe<&2, String>}
  CorePermit{}
  CoreDeny{}
  CoreInterrupt{}
  TwinInstall{id: String}
  TwinAction{}
  ArchiveCommit{}
  ArchiveSample{}
  ClusterCut{}
  CutClassify{}
  PartitionPropose{}
  CapMint{}
  CapRevoke{}
  PromptAudit{}
  StewardAck{id: String}

# Lean: `acks.any (· == id)`
def mem(+xs: List<&2, String>, +x: String) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{h, t}:
      (String.eq(h, x) || mem(t, x))

# Picks between "drop the head" and "keep it", given the recursive result.
def eraseStep(b: Bool, +h: String, +t: List<&2, String>, +r: List<&2, String>) -> List<&2, String>:
  match b:
    case True{}:
      t
    case False{}:
      h <> r

# Lean: `acks.erase id` (removes the first occurrence only).
def erase(+xs: List<&2, String>, +x: String) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      eraseStep(String.eq(h, x), h, t, erase(t, x))

# Lean: `installRequiresAckB.go`. The list shrinks first, so termination checks.
def installRequiresAck.go(+evs: List<&2, TraceEvent>, +acks: List<&2, String>) -> Bool:
  match evs:
    case Nil{}:
      True{}
    case Con{StewardAck{id}, rest}:
      installRequiresAck.go(rest, id <> acks)
    case Con{TwinInstall{id}, rest}:
      (mem(acks, id) && installRequiresAck.go(rest, erase(acks, id)))
    case Con{_, rest}:
      installRequiresAck.go(rest, acks)

# Lean: `installRequiresAckB` = `go []`.
def installRequiresAck(+evs: List<&2, TraceEvent>) -> Bool:
  installRequiresAck.go(evs, Nil{})

# Negatives, named as in spec/lean/Negatives.lean.
def silentInstall() -> List<&2, TraceEvent>:
  [TwinInstall{"demo-soma"}]

def ackReplay() -> List<&2, TraceEvent>:
  [StewardAck{"demo-soma"}, TwinInstall{"demo-soma"}, TwinInstall{"demo-soma"}]

# Green control, so the laws below are not vacuous.
def acked() -> List<&2, TraceEvent>:
  [StewardAck{"demo-soma"}, TwinInstall{"demo-soma"}]
