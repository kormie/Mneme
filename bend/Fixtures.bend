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

# --- Part 2 builders: edges with ports, named ports, and a kernel that
# satisfies every decidable law (so the conjunction has a green control). ---

def portNamed(name: String, ty: String, dir: K.Dir) -> K.Port:
  K.Port{name, ty, dir}

def edgeOf(id: String, src: String, dst: String) -> K.Edge:
  K.Edge{id, src, dst, "out", "in", K.DataEdge{}, False{}, ""}

def edgePorts(fromPort: String, toPort: String, kind: K.EdgeKind, guard: String) -> K.Edge:
  K.Edge{"e", "a", "b", fromPort, toPort, kind, False{}, guard}

def graphE(id: String, nodes: List<&2, K.Node>, edges: List<&2, K.Edge>) -> K.Graph:
  K.Graph{id, nodes, edges, "mneme.graph/1"}

def adlGood() -> K.Graph:
  graphE(
    "pg-adl",
    [
      nodeWith("partition-propose", K.Prompt{}, [portOut("TwinSpec")]),
      xform("lineage-record"),
      xform("reindex"),
      xform("holdout"),
      xform("cut-class"),
      xform("cluster")
    ],
    [edgeOf("a1", "partition-propose", "lineage-record")]
  )

def demGood() -> K.Graph:
  graphOf(
    "pg-dem",
    [
      nodeWith("author", K.Prompt{}, [portOut("TwinSpec")]),
      xform("validate"),
      nodeWith("register", K.Prompt{}, [portOut("LineageArchive")]),
      xform("archive")
    ]
  )

def coreGood() -> K.Graph:
  graphOf("pg-core", [xform("self-upd"), nodeWith("twin-auth", K.Prompt{}, [portOut("CapToken")])])

def twinGood() -> K.Graph:
  graphOf("pg-twin", [xform("action-gate"), nodeWith("core-bind", K.Prompt{}, [portIn("CapToken[]")])])

def auditGood() -> K.Graph:
  graphOf("pg-audit", [xform("audit-heuristics"), xform("sample-clean"), nodeWith("report", K.Prompt{}, [portOut("Report")])])

def w2lGood() -> K.Graph:
  graphOf("pg-w2l", hybridNodes())

# Frozen ids are "align": a transform nothing else in the laws mentions, so a
# fault elsewhere cannot also trip `frozenTransforms`.
def lawsKernelFull(
  layers: List<&2, K.Layer>, w2l: K.Graph, dem: K.Graph, adl: K.Graph, core: K.Graph,
  twin: K.Graph, audit: K.Graph, twins: List<&2, K.Twin>, frozen: List<&2, String>
) -> K.Kernel:
  K.Kernel{"mneme.spec/0.10", layers, [w2l, dem, adl, core, twin, audit], twins, frozen}

def seedTwins() -> List<&2, K.Twin>:
  [K.Twin{"demo-soma", K.Seed{}}]

def lawsKernel() -> K.Kernel:
  lawsKernelFull(fullLayers(), w2lGood(), demGood(), adlGood(), coreGood(), twinGood(), auditGood(), seedTwins(), ["align"])

# --- Single-fault variants of `lawsKernel`: each breaks exactly one conjunct. ---

def faultWellFormed() -> K.Kernel:
  lawsKernelFull(noCoreLayers(), w2lGood(), demGood(), adlGood(), coreGood(), twinGood(), auditGood(), seedTwins(), ["align"])

def faultFrozen() -> K.Kernel:
  lawsKernelFull(fullLayers(), w2lGood(), demGood(), adlGood(), coreGood(), twinGood(), auditGood(), seedTwins(), ["nope"])

def faultStructural() -> K.Kernel:
  lawsKernelFull(
    fullLayers(),
    graphOf("pg-w2l", [xform("semantic"), xform("skill"), prompt("structural"), xform("hybrid"), xform("align"), xform("commit")]),
    demGood(), adlGood(), coreGood(), twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultHybrid() -> K.Kernel:
  lawsKernelFull(
    fullLayers(),
    graphOf("pg-w2l", [xform("semantic"), xform("skill"), xform("structural"), xform("hybrid"), xform("align")]),
    demGood(), adlGood(), coreGood(), twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultAuthor() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(),
    graphOf("pg-dem", [nodeWith("author", K.Prompt{}, [portOut("IdentitySnapshot")]), xform("validate"), nodeWith("register", K.Prompt{}, [portOut("LineageArchive")]), xform("archive")]),
    adlGood(), coreGood(), twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultSelfAuth() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(), demGood(), adlGood(),
    graphOf("pg-core", [nodeWith("twin-auth", K.Prompt{}, [portOut("CapToken")])]),
    twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultCapToken() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(), demGood(), adlGood(),
    graphOf("pg-core", [xform("self-upd"), nodeWith("twin-auth", K.Prompt{}, [portOut("Decision")])]),
    twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultTwinOrigin() -> K.Kernel:
  lawsKernelFull(fullLayers(), w2lGood(), demGood(), adlGood(), coreGood(), twinGood(), auditGood(), [], ["align"])

def faultActionGate() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(), demGood(), adlGood(), coreGood(),
    graphOf("pg-twin", [nodeWith("core-bind", K.Prompt{}, [portIn("CapToken[]")])]),
    auditGood(), seedTwins(), ["align"]
  )

def faultPartition() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(), demGood(),
    graphE("pg-adl", [nodeWith("partition-propose", K.Prompt{}, [portOut("TwinSpec")]), xform("lineage-record"), xform("reindex"), xform("holdout"), xform("cut-class"), xform("cluster")], []),
    coreGood(), twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultReindex() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(), demGood(),
    graphE("pg-adl", [nodeWith("partition-propose", K.Prompt{}, [portOut("TwinSpec")]), xform("lineage-record"), nodeWith("reindex", K.Transform{}, [portIn("TwinSpec")]), xform("holdout"), xform("cut-class"), xform("cluster")], [edgeOf("a1", "partition-propose", "lineage-record")]),
    coreGood(), twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultBind() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(), demGood(), adlGood(), coreGood(),
    graphOf("pg-twin", [xform("action-gate"), nodeWith("core-bind", K.Prompt{}, [portIn("CapToken[]"), portOut("CapToken[]")])]),
    auditGood(), seedTwins(), ["align"]
  )

def faultArchive() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(),
    graphOf("pg-dem", [nodeWith("author", K.Prompt{}, [portOut("TwinSpec")]), xform("validate"), nodeWith("register", K.Prompt{}, [portOut("LineageArchive")]), prompt("archive")]),
    adlGood(), coreGood(), twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultEval() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(),
    graphOf("pg-dem", [nodeWith("author", K.Prompt{}, [portOut("TwinSpec")]), prompt("validate"), nodeWith("register", K.Prompt{}, [portOut("LineageArchive")]), xform("archive")]),
    adlGood(), coreGood(), twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultCut() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(), demGood(),
    graphE("pg-adl", [nodeWith("partition-propose", K.Prompt{}, [portOut("TwinSpec")]), xform("lineage-record"), xform("reindex"), xform("holdout"), xform("cut-class"), prompt("cluster")], [edgeOf("a1", "partition-propose", "lineage-record")]),
    coreGood(), twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultRoute() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(), demGood(),
    graphE("pg-adl", [nodeWith("partition-propose", K.Prompt{}, [portOut("TwinSpec")]), xform("lineage-record"), xform("reindex"), xform("holdout"), xform("cut-class"), xform("cluster")], [K.Edge{"a1", "partition-propose", "lineage-record", "", "in", K.DataEdge{}, False{}, ""}]),
    coreGood(), twinGood(), auditGood(), seedTwins(), ["align"]
  )

def faultAudit() -> K.Kernel:
  lawsKernelFull(
    fullLayers(), w2lGood(), demGood(), adlGood(), coreGood(), twinGood(),
    graphOf("pg-audit", [xform("audit-heuristics"), xform("sample-clean"), nodeWith("report", K.Prompt{}, [portOut("Permit")])]),
    seedTwins(), ["align"]
  )
