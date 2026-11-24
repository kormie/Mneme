import Base
import ./Kernel.bend as K

# Test fixtures for the laws. Not part of the Lean pack: a one-graph kernel
# with two nodes (a, b) and one edge (e1: a -> b), used as a green control for
# the kernel-dependent trace laws.

def tinyGraph() -> K.Graph:
  K.Graph{
    "pg-t",
    [K.Node{"a", K.Transform{}, []}, K.Node{"b", K.Transform{}, []}],
    [K.Edge{"e1", "a", "b", "out", "in", K.DataEdge{}, False{}, ""}],
    "mneme.graph/1"
  }

def tinyKernel() -> K.Kernel:
  K.Kernel{"mneme.spec/0.10", [], [tinyGraph()], [], []}

# --- Well-formedness fixtures: one well-formed kernel and one-fault variants. ---

def fullLayers() -> List<&2, K.Layer>:
  [
    K.Layer{"sensory", [], []},
    K.Layer{"working", [], []},
    K.Layer{"longterm", ["episodic", "semantic", "skills", "structural", "lineage"], []},
    K.Layer{"core", [], []}
  ]

def nodeA() -> K.Node:
  K.Node{"a", K.Transform{}, []}

def nodeB() -> K.Node:
  K.Node{"b", K.Transform{}, []}

def edgeAB() -> K.Edge:
  K.Edge{"e1", "a", "b", "out", "in", K.DataEdge{}, False{}, ""}

def kernelOf(layers: List<&2, K.Layer>, graphs: List<&2, K.Graph>) -> K.Kernel:
  K.Kernel{"mneme.spec/0.10", layers, graphs, [], []}

def wellKernel() -> K.Kernel:
  kernelOf(fullLayers(), [tinyGraph()])

def noGraphsKernel() -> K.Kernel:
  kernelOf(fullLayers(), [])

def duplicateGraphKernel() -> K.Kernel:
  kernelOf(fullLayers(), [tinyGraph(), tinyGraph()])

def duplicateNodeGraph() -> K.Graph:
  K.Graph{"pg-t", [nodeA(), nodeA()], [], "mneme.graph/1"}

def emptyNodeIdGraph() -> K.Graph:
  K.Graph{"pg-t", [K.Node{"", K.Transform{}, []}], [], "mneme.graph/1"}

def danglingEdgeGraph() -> K.Graph:
  K.Graph{"pg-t", [nodeA(), nodeB()], [K.Edge{"e2", "a", "zz", "out", "in", K.DataEdge{}, False{}, ""}], "mneme.graph/1"}

def badVersionGraph() -> K.Graph:
  K.Graph{"pg-t", [nodeA(), nodeB()], [edgeAB()], "v1"}

# 11 characters: Lean's `take 12` returns it whole, so it is not the prefix.
def shortVersionGraph() -> K.Graph:
  K.Graph{"pg-t", [nodeA(), nodeB()], [edgeAB()], "mneme.graph"}

def noCoreLayers() -> List<&2, K.Layer>:
  [
    K.Layer{"sensory", [], []},
    K.Layer{"working", [], []},
    K.Layer{"longterm", ["episodic", "semantic", "skills", "structural", "lineage"], []}
  ]

def noLineageLayers() -> List<&2, K.Layer>:
  [
    K.Layer{"sensory", [], []},
    K.Layer{"working", [], []},
    K.Layer{"longterm", ["episodic", "semantic", "skills", "structural"], []},
    K.Layer{"core", [], []}
  ]

# --- Builders for the decidable-law fixtures. No Lean counterpart. ---

def xform(id: String) -> K.Node:
  K.Node{id, K.Transform{}, []}

def prompt(id: String) -> K.Node:
  K.Node{id, K.Prompt{}, []}

def nodeWith(id: String, kind: K.NodeKind, ports: List<&2, K.Port>) -> K.Node:
  K.Node{id, kind, ports}

def portIn(ty: String) -> K.Port:
  K.Port{"p", ty, K.DirIn{}}

def portOut(ty: String) -> K.Port:
  K.Port{"p", ty, K.DirOut{}}

def graphOf(id: String, nodes: List<&2, K.Node>) -> K.Graph:
  K.Graph{id, nodes, [], "mneme.graph/1"}

def kernelG(graphs: List<&2, K.Graph>) -> K.Kernel:
  K.Kernel{"mneme.spec/0.10", [], graphs, [], []}

def kernelFrozen(graphs: List<&2, K.Graph>, frozen: List<&2, String>) -> K.Kernel:
  K.Kernel{"mneme.spec/0.10", [], graphs, [], frozen}

def kernelTwins(twins: List<&2, K.Twin>) -> K.Kernel:
  K.Kernel{"mneme.spec/0.10", [], [], twins, []}

def hybridNodes() -> List<&2, K.Node>:
  [xform("semantic"), xform("skill"), xform("structural"), xform("hybrid"), xform("align"), xform("commit")]
