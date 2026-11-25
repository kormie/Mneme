import Base

# Port of spec/lean/Kernel.lean: the normative IR. Mirrors it, never extends it.
# Lean's `Kind`, `Dir` and `EdgeKind` are renamed because Base already has a
# `Kind` and a `Data`: NodeKind, Dir{In,Out}, EdgeKind{DataEdge,ControlEdge}.

type NodeKind is Data:
  Prompt{}
  Transform{}

type Dir is Data:
  DirIn{}
  DirOut{}

type EdgeKind is Data:
  DataEdge{}
  ControlEdge{}

type Origin is Data:
  Seed{}
  Discovered{}

type Port is Data:
  Port{name: String, ty: String, dir: Dir}

type Node is Data:
  Node{id: String, kind: NodeKind, ports: List<&2, Port>}

type Edge is Data:
  Edge{id: String, from: String, to: String, fromPort: String, toPort: String, kind: EdgeKind, cyclic: Bool, guard: String}

type Graph is Data:
  Graph{id: String, nodes: List<&2, Node>, edges: List<&2, Edge>, version: String}

type Layer is Data:
  Layer{id: String, stores: List<&2, String>, graphIds: List<&2, String>}

type Twin is Data:
  Twin{id: String, origin: Origin}

type Kernel is Data:
  Kernel{spec: String, layers: List<&2, Layer>, graphs: List<&2, Graph>, twins: List<&2, Twin>, frozen: List<&2, String>}

def nodeId(+n: Node) -> String:
  match n:
    case Node{id, _, _}:
      id

def graphId(+g: Graph) -> String:
  match g:
    case Graph{id, _, _, _}:
      id

def edgeId(+e: Edge) -> String:
  match e:
    case Edge{id, _, _, _, _, _, _, _}:
      id

def pick(b: Bool, +n: Node, +rest: Maybe<&2, Node>) -> Maybe<&2, Node>:
  match b:
    case True{}:
      Some{n}
    case False{}:
      rest

# Lean: `Graph.findNode` (`g.nodes.find? (·.id == id)`).
def nodeFind(+nodes: List<&2, Node>, +id: String) -> Maybe<&2, Node>:
  match nodes:
    case Nil{}:
      None{}
    case Con{n, t}:
      pick(String.eq(nodeId(n), id), n, nodeFind(t, id))

def pickGraph(b: Bool, +g: Graph, +rest: Maybe<&2, Graph>) -> Maybe<&2, Graph>:
  match b:
    case True{}:
      Some{g}
    case False{}:
      rest

# Lean: `Kernel.findGraph`.
def graphFind(+graphs: List<&2, Graph>, +id: String) -> Maybe<&2, Graph>:
  match graphs:
    case Nil{}:
      None{}
    case Con{g, t}:
      pickGraph(String.eq(graphId(g), id), g, graphFind(t, id))

def isSome(a, -A: Kind(a), m: Maybe<a, A>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{_}:
      True{}

def findNodeIn(mg: Maybe<&2, Graph>, +nid: String) -> Maybe<&2, Node>:
  match mg:
    case None{}:
      None{}
    case Some{Graph{_, nodes, _, _}}:
      nodeFind(nodes, nid)

# Lean: `Kernel.findNode`.
def findNode(+k: Kernel, +gid: String, +nid: String) -> Maybe<&2, Node>:
  match k:
    case Kernel{_, _, graphs, _, _}:
      findNodeIn(graphFind(graphs, gid), nid)

# Lean: `g.edges.any (·.id == e)`.
def edgesAny(+edges: List<&2, Edge>, +e: String) -> Bool:
  match edges:
    case Nil{}:
      False{}
    case Con{h, t}:
      (String.eq(edgeId(h), e) || edgesAny(t, e))

# Lean: `k.graphs.any (fun g => g.edges.any (·.id == e))`.
def edgeExists(+graphs: List<&2, Graph>, +e: String) -> Bool:
  match graphs:
    case Nil{}:
      False{}
    case Con{Graph{_, _, edges, _}, t}:
      (edgesAny(edges, e) || edgeExists(t, e))

# --- Accessors and port queries used by the decidable laws. ---

def nodePorts(+n: Node) -> List<&2, Port>:
  match n:
    case Node{_, _, ports}:
      ports

def isTransform(+k: NodeKind) -> Bool:
  match k:
    case Prompt{}:
      False{}
    case Transform{}:
      True{}

def nodeIsTransform(+n: Node) -> Bool:
  match n:
    case Node{_, kind, _}:
      isTransform(kind)

# Lean: `Node.hasPortType` (`n.ports.any (·.type == ty)`).
def portsHaveType(+ps: List<&2, Port>, +ty: String) -> Bool:
  match ps:
    case Nil{}:
      False{}
    case Con{Port{_, pty, _}, t}:
      (String.eq(pty, ty) || portsHaveType(t, ty))

def hasPortType(+n: Node, +ty: String) -> Bool:
  portsHaveType(nodePorts(n), ty)

# Lean: `Node.hasOutType` (`n.ports.any (fun p => p.dir == .out && p.type == ty)`).
def portsHaveOutType(+ps: List<&2, Port>, +ty: String) -> Bool:
  match ps:
    case Nil{}:
      False{}
    case Con{Port{_, pty, DirOut{}}, t}:
      (String.eq(pty, ty) || portsHaveOutType(t, ty))
    case Con{_, t}:
      portsHaveOutType(t, ty)

def hasOutType(+n: Node, +ty: String) -> Bool:
  portsHaveOutType(nodePorts(n), ty)

# Lean: `g.nodes.any (·.id == id)`.
def nodesHave(+nodes: List<&2, Node>, +id: String) -> Bool:
  match nodes:
    case Nil{}:
      False{}
    case Con{n, t}:
      (String.eq(nodeId(n), id) || nodesHave(t, id))

def graphNodes(+g: Graph) -> List<&2, Node>:
  match g:
    case Graph{_, nodes, _, _}:
      nodes

# Lean: `n.ports.any (·.name == name)`.
def portsHaveName(+ps: List<&2, Port>, +name: String) -> Bool:
  match ps:
    case Nil{}:
      False{}
    case Con{Port{pname, _, _}, t}:
      (String.eq(pname, name) || portsHaveName(t, name))

def graphEdges(+g: Graph) -> List<&2, Edge>:
  match g:
    case Graph{_, _, edges, _}:
      edges

# Lean: `g.edges.any (fun e => e.from == a && e.to == b)`.
def edgesAnyFromTo(+edges: List<&2, Edge>, +a: String, +b: String) -> Bool:
  match edges:
    case Nil{}:
      False{}
    case Con{Edge{_, src, dst, _, _, _, _, _}, t}:
      ((String.eq(src, a) && String.eq(dst, b)) || edgesAnyFromTo(t, a, b))
