import Base
import ./Trace.bend as T
import ./Negatives.bend as N

# Human-written claims. The AI does not touch this file.
# Each law names its Lean counterpart in spec/lean (see spec/inhabitants.md).
# "red" means the predicate must reject the trace; "green" means it must accept.

# --- Negatives (spec/lean/Negatives.lean). These must stay red. ---

law silent_install_red:
  {T.installRequiresAck(N.silentInstall()) == False{} : Bool}

law ack_replay_red:
  {T.installRequiresAck(N.ackReplay()) == False{} : Bool}

law amortized_permit_red:
  {T.commitAfterPermit(N.amortizedPermit()) == False{} : Bool}

law audit_does_not_consume_red:
  {T.commitAfterPermit(N.auditDoesNotConsume()) == False{} : Bool}

# --- INV-INSTALL-REQUIRES-ACK (Trace.InstallRequiresAck) ---

law acked_install_green:
  {T.installRequiresAck([T.StewardAck{"demo-soma"}, T.TwinInstall{"demo-soma"}]) == True{} : Bool}

# Stronger than `decide`: holds for every id, not one instance.
law lone_install_red:
  for x: String
  {T.installRequiresAck([T.TwinInstall{x}]) == False{} : Bool}

# --- INV-COMMIT-TRACED (Trace.CommitAfterPermit) ---

law permit_then_write_green:
  {T.commitAfterPermit([T.CorePermit{}, T.StoreWrite{"ltm", None{}}]) == True{} : Bool}

law write_without_permit_red:
  {T.commitAfterPermit([T.StoreWrite{"ltm", None{}}]) == False{} : Bool}

law deny_flushes_permit_red:
  {T.commitAfterPermit([T.CorePermit{}, T.CoreDeny{}, T.StoreWrite{"ltm", None{}}]) == False{} : Bool}

law inbox_needs_no_permit_green:
  {T.commitAfterPermit([T.StoreWrite{"audit.inbox", None{}}]) == True{} : Bool}

law inbox_does_not_consume_permit_green:
  {T.commitAfterPermit([T.CorePermit{}, T.StoreWrite{"audit.inbox", None{}}, T.StoreWrite{"ltm", None{}}]) == True{} : Bool}

# --- INV-CORE-INTERRUPT (Trace.DenyImpliesInterrupt) ---

law deny_then_interrupt_green:
  {T.denyImpliesInterrupt([T.CoreDeny{}, T.CoreInterrupt{}]) == True{} : Bool}

law deny_without_interrupt_red:
  {T.denyImpliesInterrupt([T.CoreDeny{}, T.CorePermit{}]) == False{} : Bool}

law trailing_deny_red:
  {T.denyImpliesInterrupt([T.CoreDeny{}]) == False{} : Bool}

# --- Trace.ProposeNotInstall ---

law propose_then_install_red:
  for x: String
  {T.proposeNotInstall([T.PartitionPropose{}, T.TwinInstall{x}]) == False{} : Bool}

law propose_gap_install_green:
  {T.proposeNotInstall([T.PartitionPropose{}, T.ClusterCut{}, T.TwinInstall{"demo-soma"}]) == True{} : Bool}

# --- INV-TWIN-ID-REQUIRES-INSTALL (Trace.TwinIdRequiresInstall) ---

law installed_twin_write_green:
  {T.twinIdRequiresInstall([T.TwinInstall{"demo-soma"}, T.StoreWrite{"ltm", Some{"demo-soma"}}]) == True{} : Bool}

# A twin-tagged write with no install is rejected for every store and twin id.
law uninstalled_twin_write_red:
  for s: String
  for t: String
  {T.twinIdRequiresInstall([T.StoreWrite{s, Some{t}}]) == False{} : Bool}

law other_twin_install_red:
  {T.twinIdRequiresInstall([T.TwinInstall{"a"}, T.StoreRead{"ltm", Some{"b"}}]) == False{} : Bool}

# --- INV-CROSS-PARTITION-SAMPLE (Trace.HasClusterCut) ---

law cluster_cut_green:
  {T.hasClusterCut([T.NodeEnter{"pg-adl", "cluster"}, T.ClusterCut{}]) == True{} : Bool}

law no_cluster_cut_red:
  {T.hasClusterCut([T.NodeEnter{"pg-adl", "cluster"}]) == False{} : Bool}

# --- INV-NO-GREEDY-ONLY (Trace.HasArchiveSample) ---

law archive_sample_green:
  {T.hasArchiveSample([T.ArchiveCommit{}, T.ArchiveSample{}]) == True{} : Bool}

law no_archive_sample_red:
  {T.hasArchiveSample([T.ArchiveCommit{}]) == False{} : Bool}

# --- INV-G3-TRACE (Trace.ScheduleNonempty) ---

law node_enter_green:
  {T.scheduleNonempty([T.NodeEnter{"pg-w2l", "commit"}]) == True{} : Bool}

law empty_schedule_red:
  {T.scheduleNonempty([]) == False{} : Bool}

# --- INV-AUDIT-NO-EFFECT (Trace.AuditNotEffect) ---

law audit_then_permit_red:
  {T.auditNotEffect([T.PromptAudit{}, T.CorePermit{}]) == False{} : Bool}

law audit_then_install_red:
  {T.auditNotEffect([T.PromptAudit{}, T.TwinInstall{"demo-soma"}]) == False{} : Bool}

law audit_then_inbox_write_green:
  {T.auditNotEffect([T.PromptAudit{}, T.StoreWrite{"audit.inbox", None{}}]) == True{} : Bool}

law audit_then_ltm_write_red:
  {T.auditNotEffect([T.PromptAudit{}, T.StoreWrite{"ltm", None{}}]) == False{} : Bool}

# Entering a non-audit graph cools the trace; entering pg-audit does not.
law leaving_audit_green:
  {T.auditNotEffect([T.PromptAudit{}, T.NodeEnter{"pg-w2l", "commit"}, T.CorePermit{}]) == True{} : Bool}

law staying_in_audit_red:
  {T.auditNotEffect([T.PromptAudit{}, T.NodeEnter{"pg-audit", "audit-heuristics"}, T.StoreWrite{"ltm", None{}}]) == False{} : Bool}
