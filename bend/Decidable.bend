import Base
import ./Kernel.bend as K
import ./Util.bend as U

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
