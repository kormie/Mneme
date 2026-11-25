import Base
import ./Kernel.bend as K

# Port of spec/lean/Trace.lean (the temporal fragment). Mirrors the Lean source;
# it never extends it. Every def names its Lean counterpart.

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

# Lean: `hasClusterCutB` (`τ.any (· == .clusterCut)`).
def hasClusterCut(+evs: List<&2, TraceEvent>) -> Bool:
  match evs:
    case Nil{}:
      False{}
    case Con{ClusterCut{}, _}:
      True{}
    case Con{_, rest}:
      hasClusterCut(rest)

# Lean: `hasArchiveSampleB`.
def hasArchiveSample(+evs: List<&2, TraceEvent>) -> Bool:
  match evs:
    case Nil{}:
      False{}
    case Con{ArchiveSample{}, _}:
      True{}
    case Con{_, rest}:
      hasArchiveSample(rest)

# Lean: `scheduleNonemptyB` (some `nodeEnter` exists).
def scheduleNonempty(+evs: List<&2, TraceEvent>) -> Bool:
  match evs:
    case Nil{}:
      False{}
    case Con{NodeEnter{_, _}, _}:
      True{}
    case Con{_, rest}:
      scheduleNonempty(rest)

# Lean: `denyImpliesInterruptB`. G (core.deny -> X core.interrupt).
def denyImpliesInterrupt(+evs: List<&2, TraceEvent>) -> Bool:
  match evs:
    case Nil{}:
      True{}
    case Con{CoreDeny{}, Con{CoreInterrupt{}, rest}}:
      denyImpliesInterrupt(rest)
    case Con{CoreDeny{}, _}:
      False{}
    case Con{_, rest}:
      denyImpliesInterrupt(rest)

# Lean: `proposeNotInstallB`. partition.propose is not immediately followed
# by twin.install.
def proposeNotInstall(+evs: List<&2, TraceEvent>) -> Bool:
  match evs:
    case Nil{}:
      True{}
    case Con{PartitionPropose{}, Con{TwinInstall{_}, _}}:
      False{}
    case Con{_, rest}:
      proposeNotInstall(rest)

# Lean: `twinIdRequiresInstallB.go`. A store.read/write carrying a twin id
# needs a prior twin.install of that id.
def twinIdRequiresInstall.go(+evs: List<&2, TraceEvent>, +installed: List<&2, String>) -> Bool:
  match evs:
    case Nil{}:
      True{}
    case Con{TwinInstall{id}, rest}:
      twinIdRequiresInstall.go(rest, id <> installed)
    case Con{StoreRead{_, Some{t}}, rest}:
      (mem(installed, t) && twinIdRequiresInstall.go(rest, installed))
    case Con{StoreWrite{_, Some{t}}, rest}:
      (mem(installed, t) && twinIdRequiresInstall.go(rest, installed))
    case Con{_, rest}:
      twinIdRequiresInstall.go(rest, installed)

def twinIdRequiresInstall(+evs: List<&2, TraceEvent>) -> Bool:
  twinIdRequiresInstall.go(evs, Nil{})

# Lean: `commitAfterPermitB.go`. Per write, not per episode: every store.write
# consumes its own preceding core.permit; core.deny flushes it; audit.inbox
# neither requires nor consumes one.
#
# Lean branches on `store == "audit.inbox"`. Bend cannot match a computed
# value, and a helper that recursed back into `go` would be mutual recursion,
# so the branch is folded into Bool algebra with ONE recursive call. With
# b = (store == "audit.inbox"):
#   b      -> go permit rest     = (b || permit) && go(rest, b && permit)
#   not b  -> permit && go false = (b || permit) && go(rest, b && permit)
def commitAfterPermit.go(+evs: List<&2, TraceEvent>, +permit: Bool) -> Bool:
  match evs:
    case Nil{}:
      True{}
    case Con{CorePermit{}, rest}:
      commitAfterPermit.go(rest, True{})
    case Con{CoreDeny{}, rest}:
      commitAfterPermit.go(rest, False{})
    case Con{StoreWrite{store, _}, rest}:
      +b = String.eq(store, "audit.inbox")
      ((b || permit) && commitAfterPermit.go(rest, (b && permit)))
    case Con{_, rest}:
      commitAfterPermit.go(rest, permit)

def commitAfterPermit(+evs: List<&2, TraceEvent>) -> Bool:
  commitAfterPermit.go(evs, False{})

# Lean: `auditNotEffectB.go`. After prompt.audit, until a non-audit graph is
# entered: no permit, install, twin.action, or store.write except audit.inbox.
# `if g == "pg-audit" then hot else false` is `hot && g == "pg-audit"`.
def auditNotEffect.go(+evs: List<&2, TraceEvent>, +hot: Bool) -> Bool:
  match evs:
    case Nil{}:
      True{}
    case Con{PromptAudit{}, rest}:
      auditNotEffect.go(rest, True{})
    case Con{NodeEnter{g, _}, rest}:
      auditNotEffect.go(rest, (hot && String.eq(g, "pg-audit")))
    case Con{CorePermit{}, rest}:
      (Bool.not(hot) && auditNotEffect.go(rest, hot))
    case Con{TwinInstall{_}, rest}:
      (Bool.not(hot) && auditNotEffect.go(rest, hot))
    case Con{TwinAction{}, rest}:
      (Bool.not(hot) && auditNotEffect.go(rest, hot))
    case Con{StoreWrite{store, _}, rest}:
      ((Bool.not(hot) || String.eq(store, "audit.inbox")) && auditNotEffect.go(rest, hot))
    case Con{_, rest}:
      auditNotEffect.go(rest, hot)

def auditNotEffect(+evs: List<&2, TraceEvent>) -> Bool:
  auditNotEffect.go(evs, False{})

def mentionsExistEdge(+k: K.Kernel, +e: String) -> Bool:
  match k:
    case K.Kernel{_, _, graphs, _, _}:
      K.edgeExists(graphs, e)

# Lean: `mentionsExist`. Nodes named in the log exist; edges named in
# edgeFire exist. Ghost wires fail.
def mentionsExist(+k: K.Kernel, +ev: TraceEvent) -> Bool:
  match ev:
    case NodeEnter{g, n}:
      K.isSome(&2, K.Node, K.findNode(k, g, n))
    case NodeExit{g, n}:
      K.isSome(&2, K.Node, K.findNode(k, g, n))
    case EdgeFire{e}:
      mentionsExistEdge(k, e)
    case _:
      True{}

# Lean: `validTraceB` (`τ.all (mentionsExist k)`).
def validTrace(+k: K.Kernel, +evs: List<&2, TraceEvent>) -> Bool:
  match evs:
    case Nil{}:
      True{}
    case Con{h, t}:
      (mentionsExist(k, h) && validTrace(k, t))
