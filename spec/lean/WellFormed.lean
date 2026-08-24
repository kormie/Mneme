import Mneme.Kernel

namespace Mneme

def nodup : List String → Bool
  | [] => true
  | x :: xs => !(xs.any (· == x)) && nodup xs

def nodeIds (g : Graph) : List String :=
  g.nodes.map (·.id)

def versioned (g : Graph) : Bool :=
  g.version.take 12 == "mneme.graph/"

def graphWF (g : Graph) : Bool :=
  nodup (nodeIds g) &&
  g.nodes.all (fun n => n.id != "") &&
  g.edges.all (fun e =>
    (nodeIds g).any (· == e.«from») &&
    (nodeIds g).any (· == e.to)) &&
  versioned g

def layersFour (k : Kernel) : Bool :=
  k.layers.any (·.id == "sensory") &&
  k.layers.any (·.id == "working") &&
  k.layers.any (·.id == "longterm") &&
  k.layers.any (·.id == "core")

def longtermStores (k : Kernel) : Bool :=
  match k.layers.find? (·.id == "longterm") with
  | none => false
  | some l =>
      ["episodic", "semantic", "skills", "structural", "lineage"].all
        (fun s => l.stores.any (· == s))

/-- Decidable well-formedness of a kernel dump. This *is* the G1/G4 gate. -/
def wellFormedB (k : Kernel) : Bool :=
  !k.graphs.isEmpty &&
  k.graphs.all graphWF &&
  nodup (k.graphs.map (·.id)) &&
  layersFour k &&
  longtermStores k

def WellFormed (k : Kernel) : Prop := wellFormedB k = true

instance (k : Kernel) : Decidable (WellFormed k) :=
  inferInstanceAs (Decidable (wellFormedB k = true))

end Mneme

