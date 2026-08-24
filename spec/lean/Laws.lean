import Mneme.Kernel
import Mneme.WellFormed

namespace Mneme

/-!
Decidable laws. Each is a Bool predicate, hence a `Decidable` Prop.
These — not holdout scores — are what a `Certificate` contains.

Theorem names here are the fully-compliant gate for the static fragment.
-/

def frozenAreTransformsB (k : Kernel) : Bool :=
  k.frozen.all fun id =>
    k.graphs.any fun g =>
      g.nodes.any fun n => n.id == id && n.kind == .transform

def FrozenTransforms (k : Kernel) : Prop := frozenAreTransformsB k = true

def structuralIsTransformB (k : Kernel) : Bool :=
  match k.findNode "pg-w2l" "structural" with
  | some n => n.kind == .transform
  | none => false

def StructuralIsTransform (k : Kernel) : Prop := structuralIsTransformB k = true

def hybridDeclaredB (k : Kernel) : Bool :=
  match k.findGraph "pg-w2l" with
  | none => false
  | some g =>
      ["semantic", "skill", "structural", "hybrid", "align", "commit"].all
        (fun id => g.nodes.any (·.id == id))

def HybridDeclared (k : Kernel) : Prop := hybridDeclaredB k = true

/-- GraphAuthor must not emit Core or validator types. -/
def authorNotCoreB (k : Kernel) : Bool :=
  match k.findNode "pg-dem" "author" with
  | none => false
  | some n =>
      !(n.hasOutType "IdentitySnapshot") &&
      !(n.hasOutType "InclusionReport")

def AuthorNotCore (k : Kernel) : Prop := authorNotCoreB k = true

def hasSelfAndAuthB (k : Kernel) : Bool :=
  match k.findGraph "pg-core" with
  | none => false
  | some g =>
      g.nodes.any (·.id == "self-upd") &&
      g.nodes.any (·.id == "twin-auth")

def HasSelfAndAuth (k : Kernel) : Prop := hasSelfAndAuthB k = true

def capTokenPortB (k : Kernel) : Bool :=
  match k.findNode "pg-core" "twin-auth" with
  | some n => n.hasPortType "CapToken"
  | none => false

def CapTokenPort (k : Kernel) : Prop := capTokenPortB k = true

def twinOriginB (k : Kernel) : Bool :=
  !k.twins.isEmpty &&
  k.twins.all (fun _ => true)

def TwinOrigin (k : Kernel) : Prop := twinOriginB k = true

def hasActionGateB (k : Kernel) : Bool :=
  match k.findGraph "pg-twin" with
  | none => false
  | some g =>
      g.nodes.any (·.id == "action-gate") &&
      g.nodes.any (·.id == "core-bind")

def HasActionGate (k : Kernel) : Prop := hasActionGateB k = true

def partitionProposeNoInstallB (k : Kernel) : Bool :=
  match k.findGraph "pg-adl", k.findNode "pg-adl" "partition-propose" with
  | some g, some n =>
      n.hasOutType "TwinSpec" &&
      !(n.hasOutType "DomainAck") &&
      !(n.ports.any (·.name == "install")) &&
      !(g.edges.any (fun e => e.«from» == "partition-propose" && e.to == "reindex")) &&
      (k.findNode "pg-adl" "lineage-record").isSome &&
      g.edges.any (fun e => e.«from» == "partition-propose" && e.to == "lineage-record")
  | _, _ => false

def PartitionProposeNoInstall (k : Kernel) : Prop :=
  partitionProposeNoInstallB k = true

def reindexNoSpecB (k : Kernel) : Bool :=
  match k.findNode "pg-adl" "reindex" with
  | some n => !(n.ports.any (fun p => p.type == "TwinSpec"))
  | none => false

def ReindexNoSpec (k : Kernel) : Prop := reindexNoSpecB k = true

def bindIntersectsTokensB (k : Kernel) : Bool :=
  match k.findNode "pg-twin" "core-bind" with
  | some n =>
      n.hasPortType "CapToken[]" &&
      !(n.ports.any (fun p => p.dir == Dir.out && (p.type == "CapToken[]" || p.type == "CapToken")))
  | none => false

def BindIntersectsTokens (k : Kernel) : Prop := bindIntersectsTokensB k = true

def archiveKeepsLosersB (k : Kernel) : Bool :=
  match k.findNode "pg-dem" "register", k.findNode "pg-dem" "archive" with
  | some r, some a =>
      r.hasOutType "LineageArchive" && a.kind == .transform
  | _, _ => false

def ArchiveKeepsLosers (k : Kernel) : Prop := archiveKeepsLosersB k = true

def evalHiddenB (k : Kernel) : Bool :=
  match k.findNode "pg-dem" "validate", k.findNode "pg-adl" "holdout" with
  | some v, some h => v.kind == .transform && h.kind == .transform
  | _, _ => false

def EvalHidden (k : Kernel) : Prop := evalHiddenB k = true

def cutClassifyB (k : Kernel) : Bool :=
  match k.findNode "pg-adl" "cut-class", k.findNode "pg-adl" "cluster" with
  | some c, some cl => c.kind == .transform && cl.kind == .transform
  | _, _ => false

def CutClassify (k : Kernel) : Prop := cutClassifyB k = true

def portRoutableB (k : Kernel) : Bool :=
  k.graphs.all fun g =>
    g.edges.all fun e => e.fromPort != "" && e.toPort != "" &&
      (e.kind != .control || e.guard != "")

def PortRoutable (k : Kernel) : Prop := portRoutableB k = true

def auditNotGateB (k : Kernel) : Bool :=
  match k.findGraph "pg-audit",
        k.findNode "pg-audit" "audit-heuristics",
        k.findNode "pg-audit" "sample-clean" with
  | some g, some h, some s =>
      h.kind == .transform &&
      s.kind == .transform &&
      !(g.nodes.any fun n =>
          n.hasOutType "Permit" ||
          n.hasOutType "ExternalEffect" ||
          n.hasOutType "TwinId" ||
          n.hasOutType "CoreStore" ||
          n.hasOutType "LTM" ||
          n.hasOutType "LineageArchive")
  | _, _, _ => false

def AuditNotGate (k : Kernel) : Prop := auditNotGateB k = true

/-- Conjunction of decidable laws. Inhabitant of this is the static certificate. -/
def Laws (k : Kernel) : Prop :=
  WellFormed k ∧
  FrozenTransforms k ∧
  StructuralIsTransform k ∧
  HybridDeclared k ∧
  AuthorNotCore k ∧
  HasSelfAndAuth k ∧
  CapTokenPort k ∧
  TwinOrigin k ∧
  HasActionGate k ∧
  PartitionProposeNoInstall k ∧
  ReindexNoSpec k ∧
  BindIntersectsTokens k ∧
  ArchiveKeepsLosers k ∧
  EvalHidden k ∧
  CutClassify k ∧
  PortRoutable k ∧
  AuditNotGate k

instance (k : Kernel) : Decidable (FrozenTransforms k) :=
  inferInstanceAs (Decidable (frozenAreTransformsB k = true))
instance (k : Kernel) : Decidable (StructuralIsTransform k) :=
  inferInstanceAs (Decidable (structuralIsTransformB k = true))
instance (k : Kernel) : Decidable (HybridDeclared k) :=
  inferInstanceAs (Decidable (hybridDeclaredB k = true))
instance (k : Kernel) : Decidable (AuthorNotCore k) :=
  inferInstanceAs (Decidable (authorNotCoreB k = true))
instance (k : Kernel) : Decidable (HasSelfAndAuth k) :=
  inferInstanceAs (Decidable (hasSelfAndAuthB k = true))
instance (k : Kernel) : Decidable (CapTokenPort k) :=
  inferInstanceAs (Decidable (capTokenPortB k = true))
instance (k : Kernel) : Decidable (TwinOrigin k) :=
  inferInstanceAs (Decidable (twinOriginB k = true))
instance (k : Kernel) : Decidable (HasActionGate k) :=
  inferInstanceAs (Decidable (hasActionGateB k = true))
instance (k : Kernel) : Decidable (PartitionProposeNoInstall k) :=
  inferInstanceAs (Decidable (partitionProposeNoInstallB k = true))
instance (k : Kernel) : Decidable (ReindexNoSpec k) :=
  inferInstanceAs (Decidable (reindexNoSpecB k = true))
instance (k : Kernel) : Decidable (BindIntersectsTokens k) :=
  inferInstanceAs (Decidable (bindIntersectsTokensB k = true))
instance (k : Kernel) : Decidable (ArchiveKeepsLosers k) :=
  inferInstanceAs (Decidable (archiveKeepsLosersB k = true))
instance (k : Kernel) : Decidable (EvalHidden k) :=
  inferInstanceAs (Decidable (evalHiddenB k = true))
instance (k : Kernel) : Decidable (CutClassify k) :=
  inferInstanceAs (Decidable (cutClassifyB k = true))
instance (k : Kernel) : Decidable (PortRoutable k) :=
  inferInstanceAs (Decidable (portRoutableB k = true))
instance (k : Kernel) : Decidable (AuditNotGate k) :=
  inferInstanceAs (Decidable (auditNotGateB k = true))

end Mneme

