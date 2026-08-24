import Mneme.Kernel

namespace Mneme

/-!
Temporal fragment. A trace is an immutable list of events.
These properties are what G3 actually is. No diagram satisfies them.

`ValidTrace` is the smallest well-formedness of a log relative to a kernel.
The LTL-shaped laws are the certified runtime gate.
-/

inductive Event where
  | nodeEnter (graph node : String)
  | nodeExit (graph node : String)
  | edgeFire (edge : String)
  | storeRead (store : String) (twin : Option String)
  | storeWrite (store : String) (twin : Option String)
  | corePermit
  | coreDeny
  | coreInterrupt
  | twinInstall (id : String)
  | twinAction
  | archiveCommit
  | archiveSample
  | clusterCut
  | cutClassify
  | partitionPropose
  | capMint
  | capRevoke
  | promptAudit
  | stewardAck (id : String)
  deriving Repr, DecidableEq, BEq, Inhabited

/-- Nodes named in the log exist. Edges named in edgeFire exist. Ghost wires fail. -/
def mentionsExist (k : Kernel) : Event → Bool
  | .nodeEnter g n => (k.findNode g n).isSome
  | .nodeExit g n => (k.findNode g n).isSome
  | .edgeFire e => k.graphs.any (fun g => g.edges.any (·.id == e))
  | _ => true

def validTraceB (k : Kernel) (τ : List Event) : Bool :=
  τ.all (mentionsExist k)

def ValidTrace (k : Kernel) (τ : List Event) : Prop := validTraceB k τ = true

/-- G (core.deny → X core.interrupt). Deny is a scheduler signal. -/
def denyImpliesInterruptB : List Event → Bool
  | [] => true
  | .coreDeny :: .coreInterrupt :: rest => denyImpliesInterruptB rest
  | .coreDeny :: _ => false
  | _ :: rest => denyImpliesInterruptB rest

def DenyImpliesInterrupt (τ : List Event) : Prop := denyImpliesInterruptB τ = true

/-- Per write, not per episode: every store.write consumes its own preceding
    core.permit. A permit authorizes exactly one write; core.deny flushes any
    outstanding permit; audit.inbox neither requires nor consumes one. -/
def commitAfterPermitB : List Event → Bool :=
  let rec go (permit : Bool) : List Event → Bool
    | [] => true
    | .corePermit :: rest => go true rest
    | .coreDeny :: rest => go false rest
    | .storeWrite store _ :: rest =>
        if store == "audit.inbox" then go permit rest
        else permit && go false rest
    | _ :: rest => go permit rest
  go false

def CommitAfterPermit (τ : List Event) : Prop := commitAfterPermitB τ = true

/-- partition.propose is not immediately followed by twin.install.
    Necessary, not sufficient — TwinIdRequiresInstall is the actual close. -/
def proposeNotInstallB : List Event → Bool
  | [] => true
  | .partitionPropose :: .twinInstall _ :: _ => false
  | _ :: rest => proposeNotInstallB rest

def ProposeNotInstall (τ : List Event) : Prop := proposeNotInstallB τ = true

/-- store.read/write carrying a twin id requires a prior twin.install of that id. -/
def twinIdRequiresInstallB : List Event → Bool :=
  let rec go (installed : List String) : List Event → Bool
    | [] => true
    | .twinInstall id :: rest => go (id :: installed) rest
    | .storeRead _ (some t) :: rest => installed.any (· == t) && go installed rest
    | .storeWrite _ (some t) :: rest => installed.any (· == t) && go installed rest
    | _ :: rest => go installed rest
  go []

def TwinIdRequiresInstall (τ : List Event) : Prop := twinIdRequiresInstallB τ = true

/-- twin.install consumes a prior steward.ack for the same id. One ack blesses
    exactly one install; a replayed ack is a silent install. -/
def installRequiresAckB : List Event → Bool :=
  let rec go (acks : List String) : List Event → Bool
    | [] => true
    | .stewardAck id :: rest => go (id :: acks) rest
    | .twinInstall id :: rest => acks.any (· == id) && go (acks.erase id) rest
    | _ :: rest => go acks rest
  go []

def InstallRequiresAck (τ : List Event) : Prop := installRequiresAckB τ = true

/-- RuntimeCertificate does not skip clustering. At least one cluster.cut. -/
def hasClusterCutB (τ : List Event) : Bool :=
  τ.any (· == .clusterCut)

def HasClusterCut (τ : List Event) : Prop := hasClusterCutB τ = true

/-- Parent selection is not greedy-latest-only: at least one archive.sample. -/
def hasArchiveSampleB (τ : List Event) : Bool :=
  τ.any (· == .archiveSample)

def HasArchiveSample (τ : List Event) : Prop := hasArchiveSampleB τ = true

def scheduleNonemptyB (τ : List Event) : Bool :=
  τ.any fun
    | .nodeEnter .. => true
    | _ => false

def ScheduleNonempty (τ : List Event) : Prop := scheduleNonemptyB τ = true

/-- After prompt.audit, until a non-audit graph is entered: no permit, install,
    twin.action, or store.write except audit.inbox. -/
def auditNotEffectB : List Event → Bool :=
  let rec go (hot : Bool) : List Event → Bool
    | [] => true
    | .promptAudit :: rest => go true rest
    | .nodeEnter g _ :: rest =>
        go (if g == "pg-audit" then hot else false) rest
    | .corePermit :: rest => !hot && go hot rest
    | .twinInstall _ :: rest => !hot && go hot rest
    | .twinAction :: rest => !hot && go hot rest
    | .storeWrite store _ :: rest =>
        (!hot || store == "audit.inbox") && go hot rest
    | _ :: rest => go hot rest
  go false

def AuditNotEffect (τ : List Event) : Prop := auditNotEffectB τ = true

/-- Temporal laws over a single trace. Certified G3 is an inhabitant of this. -/
def Temporal (k : Kernel) (τ : List Event) : Prop :=
  ValidTrace k τ ∧
  ScheduleNonempty τ ∧
  DenyImpliesInterrupt τ ∧
  CommitAfterPermit τ ∧
  ProposeNotInstall τ ∧
  TwinIdRequiresInstall τ ∧
  InstallRequiresAck τ ∧
  HasClusterCut τ ∧
  HasArchiveSample τ ∧
  AuditNotEffect τ

instance (k : Kernel) (τ : List Event) : Decidable (ValidTrace k τ) :=
  inferInstanceAs (Decidable (validTraceB k τ = true))
instance (τ : List Event) : Decidable (DenyImpliesInterrupt τ) :=
  inferInstanceAs (Decidable (denyImpliesInterruptB τ = true))
instance (τ : List Event) : Decidable (CommitAfterPermit τ) :=
  inferInstanceAs (Decidable (commitAfterPermitB τ = true))
instance (τ : List Event) : Decidable (ProposeNotInstall τ) :=
  inferInstanceAs (Decidable (proposeNotInstallB τ = true))
instance (τ : List Event) : Decidable (TwinIdRequiresInstall τ) :=
  inferInstanceAs (Decidable (twinIdRequiresInstallB τ = true))
instance (τ : List Event) : Decidable (InstallRequiresAck τ) :=
  inferInstanceAs (Decidable (installRequiresAckB τ = true))
instance (τ : List Event) : Decidable (HasClusterCut τ) :=
  inferInstanceAs (Decidable (hasClusterCutB τ = true))
instance (τ : List Event) : Decidable (HasArchiveSample τ) :=
  inferInstanceAs (Decidable (hasArchiveSampleB τ = true))
instance (τ : List Event) : Decidable (ScheduleNonempty τ) :=
  inferInstanceAs (Decidable (scheduleNonemptyB τ = true))
instance (τ : List Event) : Decidable (AuditNotEffect τ) :=
  inferInstanceAs (Decidable (auditNotEffectB τ = true))

end Mneme

