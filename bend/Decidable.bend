import Base
import ./Kernel.bend as K
import ./Util.bend as U
import ./WellFormed.bend as W

# Port of spec/lean/Laws.lean, part 1: the first eight decidable laws.
# Each Lean `fooB k : Bool` is `foo(k)` here. Mirrors Lean, never extends it.

def kGraphs(+k: K.Kernel) -> List<&2, K.Graph>:
  match k:
    case K.Kernel{_, _, graphs, _, _}:
      graphs

def kFrozen(+k: K.Kernel) -> List<&2, String>:
  match k:
    case K.Kernel{_, _, _, _, frozen}:
      frozen

def kTwins(+k: K.Kernel) -> List<&2, K.Twin>:
  match k:
    case K.Kernel{_, _, _, twins, _}:
      twins

# Lean: `n.id == id && n.kind == .transform`, over `g.nodes.any`.
def nodesAnyTransform(+nodes: List<&2, K.Node>, +id: String) -> Bool:
  match nodes:
    case Nil{}:
      False{}
    case Con{n, t}:
      ((String.eq(K.nodeId(n), id) && K.nodeIsTransform(n)) || nodesAnyTransform(t, id))

# Lean: `k.graphs.any fun g => g.nodes.any ...`.
def graphsAnyTransform(+graphs: List<&2, K.Graph>, +id: String) -> Bool:
  match graphs:
    case Nil{}:
      False{}
    case Con{g, t}:
      (nodesAnyTransform(K.graphNodes(g), id) || graphsAnyTransform(t, id))

# Lean: `frozenAreTransformsB`. Every frozen id names a transform node.
def frozenTransformsOver(+frozen: List<&2, String>, +graphs: List<&2, K.Graph>) -> Bool:
  match frozen:
    case Nil{}:
      True{}
    case Con{id, t}:
      (graphsAnyTransform(graphs, id) && frozenTransformsOver(t, graphs))

def frozenTransforms(+k: K.Kernel) -> Bool:
  frozenTransformsOver(kFrozen(k), kGraphs(k))

def nodeOptIsTransform(+m: Maybe<&2, K.Node>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{n}:
      K.nodeIsTransform(n)

# Lean: `structuralIsTransformB`.
def structuralIsTransform(+k: K.Kernel) -> Bool:
  nodeOptIsTransform(K.findNode(k, "pg-w2l", "structural"))

def hybridNodes(+nodes: List<&2, K.Node>) -> Bool:
  (
    K.nodesHave(nodes, "semantic") &&
    K.nodesHave(nodes, "skill") &&
    K.nodesHave(nodes, "structural") &&
    K.nodesHave(nodes, "hybrid") &&
    K.nodesHave(nodes, "align") &&
    K.nodesHave(nodes, "commit")
  )

def hybridOf(+mg: Maybe<&2, K.Graph>) -> Bool:
  match mg:
    case None{}:
      False{}
    case Some{g}:
      hybridNodes(K.graphNodes(g))

# Lean: `hybridDeclaredB`.
def hybridDeclared(+k: K.Kernel) -> Bool:
  hybridOf(K.graphFind(kGraphs(k), "pg-w2l"))

def authorOf(+m: Maybe<&2, K.Node>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{n}:
      (Bool.not(K.hasOutType(n, "IdentitySnapshot")) && Bool.not(K.hasOutType(n, "InclusionReport")))

# Lean: `authorNotCoreB`. GraphAuthor must not emit Core or validator types.
def authorNotCore(+k: K.Kernel) -> Bool:
  authorOf(K.findNode(k, "pg-dem", "author"))

def selfAndAuthNodes(+nodes: List<&2, K.Node>) -> Bool:
  (K.nodesHave(nodes, "self-upd") && K.nodesHave(nodes, "twin-auth"))

def selfAndAuthOf(+mg: Maybe<&2, K.Graph>) -> Bool:
  match mg:
    case None{}:
      False{}
    case Some{g}:
      selfAndAuthNodes(K.graphNodes(g))

# Lean: `hasSelfAndAuthB`.
def hasSelfAndAuth(+k: K.Kernel) -> Bool:
  selfAndAuthOf(K.graphFind(kGraphs(k), "pg-core"))

def capTokenOf(+m: Maybe<&2, K.Node>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{n}:
      K.hasPortType(n, "CapToken")

# Lean: `capTokenPortB`.
def capTokenPort(+k: K.Kernel) -> Bool:
  capTokenOf(K.findNode(k, "pg-core", "twin-auth"))

def twinsNonempty(+ts: List<&2, K.Twin>) -> Bool:
  match ts:
    case Nil{}:
      False{}
    case Con{_, _}:
      True{}

# Lean: `twinOriginB` (`!k.twins.isEmpty && k.twins.all (fun _ => true)`).
def twinOrigin(+k: K.Kernel) -> Bool:
  twinsNonempty(kTwins(k))

def actionGateNodes(+nodes: List<&2, K.Node>) -> Bool:
  (K.nodesHave(nodes, "action-gate") && K.nodesHave(nodes, "core-bind"))

def actionGateOf(+mg: Maybe<&2, K.Graph>) -> Bool:
  match mg:
    case None{}:
      False{}
    case Some{g}:
      actionGateNodes(K.graphNodes(g))

# Lean: `hasActionGateB`.
def hasActionGate(+k: K.Kernel) -> Bool:
  actionGateOf(K.graphFind(kGraphs(k), "pg-twin"))

# --- Part 2: the remaining eight decidable laws and the `Laws` conjunction. ---

# Lean: `partitionProposeNoInstallB`. partition.propose proposes a TwinSpec,
# never installs, and records lineage.
def partitionProposeOf(+mg: Maybe<&2, K.Graph>, +mn: Maybe<&2, K.Node>, +hasLineage: Bool) -> Bool:
  match mg mn:
    case Some{g} Some{n}:
      (
        K.hasOutType(n, "TwinSpec") &&
        Bool.not(K.hasOutType(n, "DomainAck")) &&
        Bool.not(K.portsHaveName(K.nodePorts(n), "install")) &&
        Bool.not(K.edgesAnyFromTo(K.graphEdges(g), "partition-propose", "reindex")) &&
        hasLineage &&
        K.edgesAnyFromTo(K.graphEdges(g), "partition-propose", "lineage-record")
      )
    case _ _:
      False{}

def partitionProposeNoInstall(+k: K.Kernel) -> Bool:
  partitionProposeOf(
    K.graphFind(kGraphs(k), "pg-adl"),
    K.findNode(k, "pg-adl", "partition-propose"),
    K.isSome(&2, K.Node, K.findNode(k, "pg-adl", "lineage-record"))
  )

def reindexOf(+m: Maybe<&2, K.Node>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{n}:
      Bool.not(K.hasPortType(n, "TwinSpec"))

# Lean: `reindexNoSpecB`.
def reindexNoSpec(+k: K.Kernel) -> Bool:
  reindexOf(K.findNode(k, "pg-adl", "reindex"))

def bindOf(+m: Maybe<&2, K.Node>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{n}:
      (
        K.hasPortType(n, "CapToken[]") &&
        Bool.not(K.hasOutType(n, "CapToken[]") || K.hasOutType(n, "CapToken"))
      )

# Lean: `bindIntersectsTokensB`. core-bind takes tokens in and emits none.
def bindIntersectsTokens(+k: K.Kernel) -> Bool:
  bindOf(K.findNode(k, "pg-twin", "core-bind"))

def archiveOf(+mr: Maybe<&2, K.Node>, +ma: Maybe<&2, K.Node>) -> Bool:
  match mr ma:
    case Some{r} Some{a}:
      (K.hasOutType(r, "LineageArchive") && K.nodeIsTransform(a))
    case _ _:
      False{}

# Lean: `archiveKeepsLosersB`.
def archiveKeepsLosers(+k: K.Kernel) -> Bool:
  archiveOf(K.findNode(k, "pg-dem", "register"), K.findNode(k, "pg-dem", "archive"))

def bothTransform(+ma: Maybe<&2, K.Node>, +mb: Maybe<&2, K.Node>) -> Bool:
  match ma mb:
    case Some{a} Some{b}:
      (K.nodeIsTransform(a) && K.nodeIsTransform(b))
    case _ _:
      False{}

# Lean: `evalHiddenB`.
def evalHidden(+k: K.Kernel) -> Bool:
  bothTransform(K.findNode(k, "pg-dem", "validate"), K.findNode(k, "pg-adl", "holdout"))

# Lean: `cutClassifyB`.
def cutClassify(+k: K.Kernel) -> Bool:
  bothTransform(K.findNode(k, "pg-adl", "cut-class"), K.findNode(k, "pg-adl", "cluster"))

# Lean: `e.kind != .control || e.guard != ""`.
def guardOk(+kind: K.EdgeKind, +guard: String) -> Bool:
  match kind:
    case K.DataEdge{}:
      True{}
    case K.ControlEdge{}:
      Bool.not(String.is_empty(guard))

def edgeRoutable(+e: K.Edge) -> Bool:
  match e:
    case K.Edge{_, _, _, fromPort, toPort, kind, _, guard}:
      (
        Bool.not(String.is_empty(fromPort)) &&
        Bool.not(String.is_empty(toPort)) &&
        guardOk(kind, guard)
      )

def edgesRoutable(+edges: List<&2, K.Edge>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case Con{e, t}:
      (edgeRoutable(e) && edgesRoutable(t))

def graphsRoutable(+graphs: List<&2, K.Graph>) -> Bool:
  match graphs:
    case Nil{}:
      True{}
    case Con{g, t}:
      (edgesRoutable(K.graphEdges(g)) && graphsRoutable(t))

# Lean: `portRoutableB`. Edges name ports; control edges carry a guard.
def portRoutable(+k: K.Kernel) -> Bool:
  graphsRoutable(kGraphs(k))

def emitsEffect(+n: K.Node) -> Bool:
  (
    K.hasOutType(n, "Permit") ||
    K.hasOutType(n, "ExternalEffect") ||
    K.hasOutType(n, "TwinId") ||
    K.hasOutType(n, "CoreStore") ||
    K.hasOutType(n, "LTM") ||
    K.hasOutType(n, "LineageArchive")
  )

def anyEmitsEffect(+nodes: List<&2, K.Node>) -> Bool:
  match nodes:
    case Nil{}:
      False{}
    case Con{n, t}:
      (emitsEffect(n) || anyEmitsEffect(t))

def auditOf(+mg: Maybe<&2, K.Graph>, +mh: Maybe<&2, K.Node>, +ms: Maybe<&2, K.Node>) -> Bool:
  match mg mh ms:
    case Some{g} Some{h} Some{s}:
      (K.nodeIsTransform(h) && K.nodeIsTransform(s) && Bool.not(anyEmitsEffect(K.graphNodes(g))))
    case _ _ _:
      False{}

# Lean: `auditNotGateB`. Audit heuristics are transforms and the audit graph
# emits no permit, effect, twin id, store, LTM or archive.
def auditNotGate(+k: K.Kernel) -> Bool:
  auditOf(
    K.graphFind(kGraphs(k), "pg-audit"),
    K.findNode(k, "pg-audit", "audit-heuristics"),
    K.findNode(k, "pg-audit", "sample-clean")
  )

# Lean: `Laws`. The conjunction of the decidable laws; an inhabitant is the
# static certificate. `W.wellFormed` is the first conjunct, as in Lean.
def laws(+k: K.Kernel) -> Bool:
  (
    W.wellFormed(k) &&
    frozenTransforms(k) &&
    structuralIsTransform(k) &&
    hybridDeclared(k) &&
    authorNotCore(k) &&
    hasSelfAndAuth(k) &&
    capTokenPort(k) &&
    twinOrigin(k) &&
    hasActionGate(k) &&
    partitionProposeNoInstall(k) &&
    reindexNoSpec(k) &&
    bindIntersectsTokens(k) &&
    archiveKeepsLosers(k) &&
    evalHidden(k) &&
    cutClassify(k) &&
    portRoutable(k) &&
    auditNotGate(k)
  )
