import Base
import ./Kernel.bend as K
import ./Util.bend as U

# Port of spec/lean/WellFormed.lean: the G1/G4 gate. Mirrors it, never extends it.

# Lean: `nodup`. No element equals a later one.
def nodup(+xs: List<&2, String>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{x, rest}:
      (Bool.not(U.mem(rest, x)) && nodup(rest))

# Lean: `nodeIds` (`g.nodes.map (·.id)`).
def nodeIds(+nodes: List<&2, K.Node>) -> List<&2, String>:
  match nodes:
    case Nil{}:
      Nil{}
    case Con{n, t}:
      K.nodeId(n) <> nodeIds(t)

# Lean: `g.nodes.all (fun n => n.id != "")`.
def allNamed(+nodes: List<&2, K.Node>) -> Bool:
  match nodes:
    case Nil{}:
      True{}
    case Con{n, t}:
      (Bool.not(String.is_empty(K.nodeId(n))) && allNamed(t))

# Lean: every edge's `from` and `to` are node ids of the graph.
def edgesResolve(+edges: List<&2, K.Edge>, +ids: List<&2, String>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case Con{K.Edge{_, src, dst, _, _, _, _, _}, t}:
      ((U.mem(ids, src) && U.mem(ids, dst)) && edgesResolve(t, ids))

# Lean: `versioned` (`g.version.take 12 == "mneme.graph/"`).
def versioned(+v: String) -> Bool:
  String.eq(String.take(v, 12n), "mneme.graph/")

# Lean: `graphWF`.
def graphWF(+g: K.Graph) -> Bool:
  match g:
    case K.Graph{_, nodes, edges, version}:
      (
        nodup(nodeIds(nodes)) &&
        allNamed(nodes) &&
        edgesResolve(edges, nodeIds(nodes)) &&
        versioned(version)
      )

# Lean: `k.graphs.all graphWF`.
def allGraphsWF(+gs: List<&2, K.Graph>) -> Bool:
  match gs:
    case Nil{}:
      True{}
    case Con{g, t}:
      (graphWF(g) && allGraphsWF(t))

def graphIds(+gs: List<&2, K.Graph>) -> List<&2, String>:
  match gs:
    case Nil{}:
      Nil{}
    case Con{g, t}:
      K.graphId(g) <> graphIds(t)

def nonempty(+gs: List<&2, K.Graph>) -> Bool:
  match gs:
    case Nil{}:
      False{}
    case Con{_, _}:
      True{}

def layerId(+l: K.Layer) -> String:
  match l:
    case K.Layer{id, _, _}:
      id

# Lean: `k.layers.any (·.id == id)`.
def layersAny(+ls: List<&2, K.Layer>, +id: String) -> Bool:
  match ls:
    case Nil{}:
      False{}
    case Con{l, t}:
      (String.eq(layerId(l), id) || layersAny(t, id))

# Lean: `layersFour`.
def layersFour(+ls: List<&2, K.Layer>) -> Bool:
  (
    layersAny(ls, "sensory") &&
    layersAny(ls, "working") &&
    layersAny(ls, "longterm") &&
    layersAny(ls, "core")
  )

def pickLayer(b: Bool, +l: K.Layer, +rest: Maybe<&2, K.Layer>) -> Maybe<&2, K.Layer>:
  match b:
    case True{}:
      Some{l}
    case False{}:
      rest

# Lean: `k.layers.find? (·.id == "longterm")`.
def layerFind(+ls: List<&2, K.Layer>, +id: String) -> Maybe<&2, K.Layer>:
  match ls:
    case Nil{}:
      None{}
    case Con{l, t}:
      pickLayer(String.eq(layerId(l), id), l, layerFind(t, id))

def storesHave(+m: Maybe<&2, K.Layer>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{K.Layer{_, stores, _}}:
      (
        U.mem(stores, "episodic") &&
        U.mem(stores, "semantic") &&
        U.mem(stores, "skills") &&
        U.mem(stores, "structural") &&
        U.mem(stores, "lineage")
      )

# Lean: `longtermStores`.
def longtermStores(+ls: List<&2, K.Layer>) -> Bool:
  storesHave(layerFind(ls, "longterm"))

def wellFormedParts(+layers: List<&2, K.Layer>, +graphs: List<&2, K.Graph>) -> Bool:
  (
    nonempty(graphs) &&
    allGraphsWF(graphs) &&
    nodup(graphIds(graphs)) &&
    layersFour(layers) &&
    longtermStores(layers)
  )

# Lean: `wellFormedB`. This is the G1/G4 gate.
def wellFormed(+k: K.Kernel) -> Bool:
  match k:
    case K.Kernel{_, layers, graphs, _, _}:
      wellFormedParts(layers, graphs)
