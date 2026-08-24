namespace Mneme

/-- Normative IR. Coordinates, prompts, and compile prose are not here. -/

inductive Kind where
  | prompt
  | transform
  deriving Repr, DecidableEq, Inhabited

inductive Dir where
  | «in»
  | out
  deriving Repr, DecidableEq, Inhabited

inductive EdgeKind where
  | data
  | control
  deriving Repr, DecidableEq, Inhabited

inductive Origin where
  | seed
  | discovered
  deriving Repr, DecidableEq, Inhabited

structure Port where
  name : String
  type : String
  dir : Dir
  deriving Repr, Inhabited

structure Node where
  id : String
  kind : Kind
  ports : List Port
  deriving Repr, Inhabited

structure Edge where
  id : String
  «from» : String
  to : String
  fromPort : String
  toPort : String
  kind : EdgeKind
  cyclic : Bool
  guard : String
  deriving Repr, Inhabited

structure Graph where
  id : String
  nodes : List Node
  edges : List Edge
  version : String
  deriving Repr, Inhabited

structure Layer where
  id : String
  stores : List String
  graphIds : List String
  deriving Repr, Inhabited

structure Twin where
  id : String
  origin : Origin
  deriving Repr, Inhabited

structure Kernel where
  spec : String
  layers : List Layer
  graphs : List Graph
  twins : List Twin
  frozen : List String
  deriving Repr, Inhabited

def Graph.findNode (g : Graph) (id : String) : Option Node :=
  g.nodes.find? (·.id == id)

def Kernel.findGraph (k : Kernel) (id : String) : Option Graph :=
  k.graphs.find? (·.id == id)

def Kernel.findNode (k : Kernel) (graphId nodeId : String) : Option Node :=
  match k.findGraph graphId with
  | none => none
  | some g => g.findNode nodeId

def Node.hasPortType (n : Node) (ty : String) : Bool :=
  n.ports.any (·.type == ty)

def Node.hasOutType (n : Node) (ty : String) : Bool :=
  n.ports.any (fun p => p.dir == .out && p.type == ty)

end Mneme

