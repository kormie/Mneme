import Base
import ./Kernel.bend as K
import ./Trace.bend as T
import ./WellFormed.bend as W
import ./Decidable.bend as D
import ./Negatives.bend as N
import ./Fixtures.bend as F

# Human-written claims. The AI does not touch this file.
# Each law names its Lean counterpart in spec/lean (see spec/inhabitants.md).
# "red" means the predicate must reject the input; "green" means it must accept.
# Every law is preceded by a comment that says, in plain English, what it states.

# --- Negatives (spec/lean/Negatives.lean). These must stay red. ---

# A twin.install with no steward.ack before it is rejected. (The "silent
# install" attack: installing a twin without the steward's say-so.)
law silent_install_red:
  {T.installRequiresAck(N.silentInstall()) == False{} : Bool}

# One steward.ack authorizes only one install: ack once, install twice is
# rejected. (The "ack replay" attack.)
law ack_replay_red:
  {T.installRequiresAck(N.ackReplay()) == False{} : Bool}

# One core.permit authorizes only one write: a permit followed by two store
# writes is rejected. (The "amortized permit" attack.)
law amortized_permit_red:
  {T.commitAfterPermit(N.amortizedPermit()) == False{} : Bool}

# Writing to audit.inbox needs no permit, but it is not a free pass: an inbox
# write followed by an LTM write with no permit of its own is rejected.
law audit_does_not_consume_red:
  {T.commitAfterPermit(N.auditDoesNotConsume()) == False{} : Bool}

# A trace that fires an edge the kernel never declares is invalid. (The "ghost
# edge" attack: version 0.8 ignored edge firings.)
law ghost_edge_red:
  {T.mentionsExist(N.emptyKernel(), N.ghostEdge()) == False{} : Bool}

# --- INV-ATTACKS-RED (Negatives.attacksRed): all five at once. ---

# All five attack traces above are rejected at once. This is the one claim the
# regression suite must never turn green.
law attacks_red:
  {N.attacksRed() == True{} : Bool}

# --- INV-INSTALL-REQUIRES-ACK (Trace.InstallRequiresAck) ---

# A twin.install preceded by a steward.ack for the same twin is accepted.
law acked_install_green:
  {T.installRequiresAck([T.StewardAck{"demo-soma"}, T.TwinInstall{"demo-soma"}]) == True{} : Bool}

# A twin.install with no steward.ack is rejected for every possible twin id,
# not just one example (stronger than checking a single trace).
law lone_install_red:
  for x: String
  {T.installRequiresAck([T.TwinInstall{x}]) == False{} : Bool}

# --- INV-COMMIT-TRACED (Trace.CommitAfterPermit) ---

# A store write preceded by its own core.permit is accepted.
law permit_then_write_green:
  {T.commitAfterPermit([T.CorePermit{}, T.StoreWrite{"ltm", None{}}]) == True{} : Bool}

# A store write with no core.permit before it is rejected.
law write_without_permit_red:
  {T.commitAfterPermit([T.StoreWrite{"ltm", None{}}]) == False{} : Bool}

# A core.deny cancels any outstanding permit, so a permit, then a deny, then a
# write is rejected.
law deny_flushes_permit_red:
  {T.commitAfterPermit([T.CorePermit{}, T.CoreDeny{}, T.StoreWrite{"ltm", None{}}]) == False{} : Bool}

# A write to audit.inbox needs no permit.
law inbox_needs_no_permit_green:
  {T.commitAfterPermit([T.StoreWrite{"audit.inbox", None{}}]) == True{} : Bool}

# A write to audit.inbox does not use up a permit, so a permit, then an inbox
# write, then an LTM write is accepted.
law inbox_does_not_consume_permit_green:
  {T.commitAfterPermit([T.CorePermit{}, T.StoreWrite{"audit.inbox", None{}}, T.StoreWrite{"ltm", None{}}]) == True{} : Bool}

# --- INV-CORE-INTERRUPT (Trace.DenyImpliesInterrupt) ---

# A core.deny immediately followed by a core.interrupt is accepted: a denial
# must stop the scheduler.
law deny_then_interrupt_green:
  {T.denyImpliesInterrupt([T.CoreDeny{}, T.CoreInterrupt{}]) == True{} : Bool}

# A core.deny followed by anything other than a core.interrupt is rejected.
law deny_without_interrupt_red:
  {T.denyImpliesInterrupt([T.CoreDeny{}, T.CorePermit{}]) == False{} : Bool}

# A core.deny at the very end of a trace, with no interrupt after it, is
# rejected.
law trailing_deny_red:
  {T.denyImpliesInterrupt([T.CoreDeny{}]) == False{} : Bool}

# --- Trace.ProposeNotInstall ---

# A partition.propose immediately followed by a twin.install is rejected for
# every twin id: proposing must never install.
law propose_then_install_red:
  for x: String
  {T.proposeNotInstall([T.PartitionPropose{}, T.TwinInstall{x}]) == False{} : Bool}

# A partition.propose followed by other events before any twin.install is
# accepted. This law forbids only immediate adjacency; the steward-ack law
# covers the rest.
law propose_gap_install_green:
  {T.proposeNotInstall([T.PartitionPropose{}, T.ClusterCut{}, T.TwinInstall{"demo-soma"}]) == True{} : Bool}

# --- INV-TWIN-ID-REQUIRES-INSTALL (Trace.TwinIdRequiresInstall) ---

# A store write tagged with a twin id is accepted once that twin has been
# installed.
law installed_twin_write_green:
  {T.twinIdRequiresInstall([T.TwinInstall{"demo-soma"}, T.StoreWrite{"ltm", Some{"demo-soma"}}]) == True{} : Bool}

# A store write tagged with a twin id that was never installed is rejected,
# for every store and every twin id.
law uninstalled_twin_write_red:
  for s: String
  for t: String
  {T.twinIdRequiresInstall([T.StoreWrite{s, Some{t}}]) == False{} : Bool}

# Installing twin a does not license reads tagged with twin b: the install
# must be for the same id.
law other_twin_install_red:
  {T.twinIdRequiresInstall([T.TwinInstall{"a"}, T.StoreRead{"ltm", Some{"b"}}]) == False{} : Bool}

# --- INV-CROSS-PARTITION-SAMPLE (Trace.HasClusterCut) ---

# A trace that contains a cluster.cut is accepted: the run did not skip
# clustering.
law cluster_cut_green:
  {T.hasClusterCut([T.NodeEnter{"pg-adl", "cluster"}, T.ClusterCut{}]) == True{} : Bool}

# A trace with no cluster.cut is rejected.
law no_cluster_cut_red:
  {T.hasClusterCut([T.NodeEnter{"pg-adl", "cluster"}]) == False{} : Bool}

# --- INV-NO-GREEDY-ONLY (Trace.HasArchiveSample) ---

# A trace that contains an archive.sample is accepted: parent selection looked
# beyond the latest entry.
law archive_sample_green:
  {T.hasArchiveSample([T.ArchiveCommit{}, T.ArchiveSample{}]) == True{} : Bool}

# A trace with no archive.sample is rejected: parent selection was greedy-
# latest only.
law no_archive_sample_red:
  {T.hasArchiveSample([T.ArchiveCommit{}]) == False{} : Bool}

# --- INV-G3-TRACE (Trace.ScheduleNonempty) ---

# A trace in which at least one node was entered is accepted: something was
# actually scheduled.
law node_enter_green:
  {T.scheduleNonempty([T.NodeEnter{"pg-w2l", "commit"}]) == True{} : Bool}

# An empty trace is rejected: nothing was scheduled.
law empty_schedule_red:
  {T.scheduleNonempty([]) == False{} : Bool}

# --- INV-AUDIT-NO-EFFECT (Trace.AuditNotEffect) ---

# After a prompt.audit, a core.permit is rejected: auditing must not grant
# authority.
law audit_then_permit_red:
  {T.auditNotEffect([T.PromptAudit{}, T.CorePermit{}]) == False{} : Bool}

# After a prompt.audit, a twin.install is rejected.
law audit_then_install_red:
  {T.auditNotEffect([T.PromptAudit{}, T.TwinInstall{"demo-soma"}]) == False{} : Bool}

# After a prompt.audit, a write to audit.inbox is accepted: the audit may
# report to the steward's inbox.
law audit_then_inbox_write_green:
  {T.auditNotEffect([T.PromptAudit{}, T.StoreWrite{"audit.inbox", None{}}]) == True{} : Bool}

# After a prompt.audit, a write to LTM is rejected: auditing must not change
# memory.
law audit_then_ltm_write_red:
  {T.auditNotEffect([T.PromptAudit{}, T.StoreWrite{"ltm", None{}}]) == False{} : Bool}

# Once the trace enters a graph other than pg-audit the audit no longer
# applies, so a permit afterwards is accepted.
law leaving_audit_green:
  {T.auditNotEffect([T.PromptAudit{}, T.NodeEnter{"pg-w2l", "commit"}, T.CorePermit{}]) == True{} : Bool}

# Entering a pg-audit node does not end the audit, so an LTM write after it is
# still rejected.
law staying_in_audit_red:
  {T.auditNotEffect([T.PromptAudit{}, T.NodeEnter{"pg-audit", "audit-heuristics"}, T.StoreWrite{"ltm", None{}}]) == False{} : Bool}

# --- Trace.ValidTrace / mentionsExist (kernel-dependent) ---

# A trace event that enters a node the kernel declares is accepted.
law node_in_kernel_green:
  {T.mentionsExist(F.tinyKernel(), T.NodeEnter{"pg-t", "a"}) == True{} : Bool}

# Entering a node the kernel does not declare, in a graph that does exist, is
# rejected.
law ghost_node_red:
  {T.mentionsExist(F.tinyKernel(), T.NodeEnter{"pg-t", "zz"}) == False{} : Bool}

# Exiting a node of a graph the kernel does not declare is rejected.
law ghost_graph_red:
  {T.mentionsExist(F.tinyKernel(), T.NodeExit{"pg-zz", "a"}) == False{} : Bool}

# Firing an edge the kernel declares is accepted.
law edge_in_kernel_green:
  {T.mentionsExist(F.tinyKernel(), T.EdgeFire{"e1"}) == True{} : Bool}

# Events that name no node or edge, such as a core.permit, are always valid,
# whatever the kernel is.
law unnamed_event_exists:
  for k: K.Kernel
  {T.mentionsExist(k, T.CorePermit{}) == True{} : Bool}

# A trace made only of declared nodes and edges is valid.
law valid_trace_green:
  {T.validTrace(F.tinyKernel(), [T.NodeEnter{"pg-t", "a"}, T.EdgeFire{"e1"}, T.NodeExit{"pg-t", "b"}]) == True{} : Bool}

# One ghost edge anywhere in a trace makes the whole trace invalid.
law ghost_in_trace_red:
  {T.validTrace(F.tinyKernel(), [T.NodeEnter{"pg-t", "a"}, T.EdgeFire{"zz9"}]) == False{} : Bool}

# The empty trace is valid in every kernel.
law empty_trace_valid:
  for k: K.Kernel
  {T.validTrace(k, []) == True{} : Bool}

# --- INV-G1-ENUMERABLE (WellFormed.WellFormed) ---

# A kernel with all four layers, the required long-term stores and one well-
# formed graph is well formed.
law well_formed_green:
  {W.wellFormed(F.wellKernel()) == True{} : Bool}

# A kernel with no graphs is not well formed.
law no_graphs_red:
  {W.wellFormed(F.noGraphsKernel()) == False{} : Bool}

# Two graphs sharing an id make a kernel ill-formed.
law duplicate_graph_red:
  {W.wellFormed(F.duplicateGraphKernel()) == False{} : Bool}

# A kernel missing the core layer is ill-formed.
law missing_core_layer_red:
  {W.wellFormed(F.kernelOf(F.noCoreLayers(), [F.tinyGraph()])) == False{} : Bool}

# A kernel whose long-term layer lacks the lineage store is ill-formed.
law missing_lineage_store_red:
  {W.wellFormed(F.kernelOf(F.noLineageLayers(), [F.tinyGraph()])) == False{} : Bool}

# One ill-formed graph (here, a bad version string) makes the whole kernel
# ill-formed.
law ill_formed_graph_makes_kernel_red:
  {W.wellFormed(F.kernelOf(F.fullLayers(), [F.badVersionGraph()])) == False{} : Bool}

# --- INV-LAYERS-FOUR (WellFormed.layersFour) ---

# A kernel with sensory, working, longterm and core layers has the four
# layers.
law layers_four_green:
  {W.layersFour(F.fullLayers()) == True{} : Bool}

# Missing any one of the four layers (here, core) is rejected.
law layers_four_missing_red:
  {W.layersFour(F.noCoreLayers()) == False{} : Bool}

# A kernel with no layers is rejected.
law layers_four_empty_red:
  {W.layersFour([]) == False{} : Bool}

# --- INV-G4-VERSIONED (WellFormed.graphWF) ---

# A graph with unique, non-empty node ids, edges between its own nodes and a
# mneme.graph/ version is well formed.
law graph_wf_green:
  {W.graphWF(F.tinyGraph()) == True{} : Bool}

# Two nodes with the same id make a graph ill-formed.
law duplicate_node_red:
  {W.graphWF(F.duplicateNodeGraph()) == False{} : Bool}

# A node with an empty id makes a graph ill-formed.
law empty_node_id_red:
  {W.graphWF(F.emptyNodeIdGraph()) == False{} : Bool}

# An edge pointing at a node the graph does not have makes the graph ill-
# formed.
law dangling_edge_red:
  {W.graphWF(F.danglingEdgeGraph()) == False{} : Bool}

# A graph whose version does not start with mneme.graph/ is ill-formed.
law bad_version_red:
  {W.graphWF(F.badVersionGraph()) == False{} : Bool}

# The version `mneme.graph` (no trailing slash, shorter than the prefix) is
# rejected: it is a truncation of the prefix, not the prefix itself.
law short_version_red:
  {W.graphWF(F.shortVersionGraph()) == False{} : Bool}

# A version string that starts with mneme.graph/ is accepted.
law versioned_prefix_green:
  {W.versioned("mneme.graph/7") == True{} : Bool}

# --- WellFormed.nodup ---

# The empty list has no duplicates.
law nodup_empty_green:
  {W.nodup([]) == True{} : Bool}

# A list of distinct names has no duplicates.
law nodup_distinct_green:
  {W.nodup(["a", "b", "c"]) == True{} : Bool}

# A list in which a name appears twice has duplicates, even when the two
# copies are not next to each other.
law nodup_repeat_red:
  {W.nodup(["a", "b", "a"]) == False{} : Bool}

# --- INV-G2-KIND-SPLIT (Laws.FrozenTransforms): frozen ids name transform nodes ---

# A frozen id that names a transform node is accepted.
law frozen_transform_green:
  {D.frozenTransforms(F.kernelFrozen([F.graphOf("pg-dem", [F.xform("validate")])], ["validate"])) == True{} : Bool}

# A kernel that freezes nothing passes trivially.
law frozen_nothing_green:
  {D.frozenTransforms(F.kernelFrozen([], [])) == True{} : Bool}

# A frozen id may be found in any graph, not just the first.
law frozen_found_in_later_graph_green:
  {D.frozenTransforms(F.kernelFrozen([F.graphOf("pg-a", [F.xform("a")]), F.graphOf("pg-b", [F.xform("b")])], ["b"])) == True{} : Bool}

# A frozen id that names a prompt node is rejected: a frozen surface must be
# code, not a model.
law frozen_prompt_red:
  {D.frozenTransforms(F.kernelFrozen([F.graphOf("pg-dem", [F.prompt("validate")])], ["validate"])) == False{} : Bool}

# A frozen id that names no node at all is rejected.
law frozen_missing_red:
  {D.frozenTransforms(F.kernelFrozen([F.graphOf("pg-dem", [F.xform("validate")])], ["holdout"])) == False{} : Bool}

# --- INV-STRUCTURAL-NO-MODEL (Laws.StructuralIsTransform) ---

# The structural node in pg-w2l being a transform is accepted.
law structural_transform_green:
  {D.structuralIsTransform(F.kernelG([F.graphOf("pg-w2l", [F.xform("structural")])])) == True{} : Bool}

# If structural is a prompt, a model is doing structural work, so it is
# rejected.
law structural_prompt_red:
  {D.structuralIsTransform(F.kernelG([F.graphOf("pg-w2l", [F.prompt("structural")])])) == False{} : Bool}

# A pg-w2l with no structural node is rejected.
law structural_absent_red:
  {D.structuralIsTransform(F.kernelG([F.graphOf("pg-w2l", [F.xform("other")])])) == False{} : Bool}

# A structural node in some other graph does not count: it must be in pg-w2l.
law structural_wrong_graph_red:
  {D.structuralIsTransform(F.kernelG([F.graphOf("pg-dem", [F.xform("structural")])])) == False{} : Bool}

# --- INV-HYBRID-DECLARED (Laws.HybridDeclared) ---

# pg-w2l declaring all six nodes (semantic, skill, structural, hybrid, align,
# commit) is accepted.
law hybrid_green:
  {D.hybridDeclared(F.kernelG([F.graphOf("pg-w2l", F.hybridNodes())])) == True{} : Bool}

# pg-w2l missing its commit node is rejected.
law hybrid_missing_commit_red:
  {D.hybridDeclared(F.kernelG([F.graphOf("pg-w2l", [F.xform("semantic"), F.xform("skill"), F.xform("structural"), F.xform("hybrid"), F.xform("align")])])) == False{} : Bool}

# A kernel with no pg-w2l graph is rejected.
law hybrid_no_graph_red:
  {D.hybridDeclared(F.kernelG([])) == False{} : Bool}

# The six nodes in a graph other than pg-w2l do not count.
law hybrid_wrong_graph_red:
  {D.hybridDeclared(F.kernelG([F.graphOf("pg-dem", F.hybridNodes())])) == False{} : Bool}

# --- INV-CORE-NOT-DARWINIAN (Laws.AuthorNotCore) ---

# The graph author (in pg-dem) emitting only a TwinSpec is accepted.
law author_green:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("author", K.Prompt{}, [F.portOut("TwinSpec")])])])) == True{} : Bool}

# If the graph author emits an IdentitySnapshot it could write Core, so it is
# rejected.
law author_emits_identity_red:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("author", K.Prompt{}, [F.portOut("IdentitySnapshot")])])])) == False{} : Bool}

# If the graph author emits an InclusionReport it is impersonating the
# validator, so it is rejected, even when it also emits a TwinSpec.
law author_emits_inclusion_red:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("author", K.Prompt{}, [F.portOut("TwinSpec"), F.portOut("InclusionReport")])])])) == False{} : Bool}

# Only OUTPUT ports count: an author that merely reads an IdentitySnapshot is
# accepted.
law author_reads_identity_green:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("author", K.Prompt{}, [F.portIn("IdentitySnapshot"), F.portOut("TwinSpec")])])])) == True{} : Bool}

# A pg-dem with no author node is rejected.
law author_absent_red:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.xform("other")])])) == False{} : Bool}

# --- INV-TWINS-NEVER-WRITE-CORE (Laws.HasSelfAndAuth) ---

# pg-core declaring both self-upd and twin-auth is accepted.
law self_and_auth_green:
  {D.hasSelfAndAuth(F.kernelG([F.graphOf("pg-core", [F.xform("self-upd"), F.xform("twin-auth")])])) == True{} : Bool}

# pg-core with self-upd but no twin-auth is rejected.
law self_and_auth_missing_auth_red:
  {D.hasSelfAndAuth(F.kernelG([F.graphOf("pg-core", [F.xform("self-upd")])])) == False{} : Bool}

# The two nodes in a graph other than pg-core do not count.
law self_and_auth_wrong_graph_red:
  {D.hasSelfAndAuth(F.kernelG([F.graphOf("pg-twin", [F.xform("self-upd"), F.xform("twin-auth")])])) == False{} : Bool}

# --- INV-CAP-TOKENS (Laws.CapTokenPort) ---

# The twin-auth node in pg-core having a CapToken port is accepted.
law cap_token_port_green:
  {D.capTokenPort(F.kernelG([F.graphOf("pg-core", [F.nodeWith("twin-auth", K.Prompt{}, [F.portOut("CapToken")])])])) == True{} : Bool}

# The CapToken port may be an input or an output; either direction counts.
law cap_token_port_any_direction_green:
  {D.capTokenPort(F.kernelG([F.graphOf("pg-core", [F.nodeWith("twin-auth", K.Prompt{}, [F.portIn("CapToken")])])])) == True{} : Bool}

# A twin-auth with no CapToken port is rejected.
law cap_token_port_absent_red:
  {D.capTokenPort(F.kernelG([F.graphOf("pg-core", [F.nodeWith("twin-auth", K.Prompt{}, [F.portOut("TwinSpec")])])])) == False{} : Bool}

# The port type must be exactly CapToken: `CapToken[]` is a different type and
# does not count.
law cap_token_array_is_not_cap_token_red:
  {D.capTokenPort(F.kernelG([F.graphOf("pg-core", [F.nodeWith("twin-auth", K.Prompt{}, [F.portOut("CapToken[]")])])])) == False{} : Bool}

# --- INV-SEEDS-NOT-ONTOLOGY (Laws.TwinOrigin) ---

# A kernel that declares at least one twin (here, a seed twin) is accepted.
law twin_origin_green:
  {D.twinOrigin(F.kernelTwins([K.Twin{"demo-soma", K.Seed{}}])) == True{} : Bool}

# A kernel that declares no twins is rejected.
law twin_origin_empty_red:
  {D.twinOrigin(F.kernelTwins([])) == False{} : Bool}

# --- INV-ACTION-GATE (Laws.HasActionGate) ---

# pg-twin declaring both action-gate and core-bind is accepted.
law action_gate_green:
  {D.hasActionGate(F.kernelG([F.graphOf("pg-twin", [F.xform("action-gate"), F.xform("core-bind")])])) == True{} : Bool}

# pg-twin with action-gate but no core-bind is rejected.
law action_gate_missing_bind_red:
  {D.hasActionGate(F.kernelG([F.graphOf("pg-twin", [F.xform("action-gate")])])) == False{} : Bool}

# The two nodes in a graph other than pg-twin do not count.
law action_gate_wrong_graph_red:
  {D.hasActionGate(F.kernelG([F.graphOf("pg-core", [F.xform("action-gate"), F.xform("core-bind")])])) == False{} : Bool}

# --- INV-PARTITION-NOT-INSTALL (Laws.PartitionProposeNoInstall) ---

# A partition proposer that emits a TwinSpec, has no install port, never feeds
# reindex, and records lineage is accepted.
law partition_propose_green:
  {D.partitionProposeNoInstall(F.kernelG([F.adlGood()])) == True{} : Bool}

# A proposer that also emits a DomainAck can install a twin by itself, so it is rejected.
law partition_propose_emits_ack_red:
  {D.partitionProposeNoInstall(F.kernelG([F.graphE("pg-adl", [F.nodeWith("partition-propose", K.Prompt{}, [F.portOut("TwinSpec"), F.portOut("DomainAck")]), F.xform("lineage-record")], [F.edgeOf("a1", "partition-propose", "lineage-record")])])) == False{} : Bool}

# A proposer with a port named "install" is rejected, whatever that port's type is.
law partition_propose_install_port_red:
  {D.partitionProposeNoInstall(F.kernelG([F.graphE("pg-adl", [F.nodeWith("partition-propose", K.Prompt{}, [F.portOut("TwinSpec"), F.portNamed("install", "Flag", K.DirIn{})]), F.xform("lineage-record")], [F.edgeOf("a1", "partition-propose", "lineage-record")])])) == False{} : Bool}

# A wire straight from the proposer to reindex skips the steward, so it is rejected.
law partition_propose_to_reindex_red:
  {D.partitionProposeNoInstall(F.kernelG([F.graphE("pg-adl", [F.nodeWith("partition-propose", K.Prompt{}, [F.portOut("TwinSpec")]), F.xform("lineage-record"), F.xform("reindex")], [F.edgeOf("a1", "partition-propose", "lineage-record"), F.edgeOf("a2", "partition-propose", "reindex")])])) == False{} : Bool}

# The graph must declare a lineage-record node; an edge alone is not enough.
law partition_propose_no_lineage_node_red:
  {D.partitionProposeNoInstall(F.kernelG([F.graphE("pg-adl", [F.nodeWith("partition-propose", K.Prompt{}, [F.portOut("TwinSpec")])], [F.edgeOf("a1", "partition-propose", "lineage-record")])])) == False{} : Bool}

# The proposer must actually be wired to lineage-record; the node alone is not enough.
law partition_propose_no_lineage_edge_red:
  {D.partitionProposeNoInstall(F.kernelG([F.graphE("pg-adl", [F.nodeWith("partition-propose", K.Prompt{}, [F.portOut("TwinSpec")]), F.xform("lineage-record")], [])])) == False{} : Bool}

# A proposer that does not emit a TwinSpec has nothing to propose, so it is rejected.
law partition_propose_no_twinspec_red:
  {D.partitionProposeNoInstall(F.kernelG([F.graphE("pg-adl", [F.nodeWith("partition-propose", K.Prompt{}, [F.portOut("Other")]), F.xform("lineage-record")], [F.edgeOf("a1", "partition-propose", "lineage-record")])])) == False{} : Bool}

# --- INV-REINDEX-NO-SPEC (Laws.ReindexNoSpec) ---

# A reindex node with no TwinSpec port is accepted.
law reindex_no_spec_green:
  {D.reindexNoSpec(F.kernelG([F.graphOf("pg-adl", [F.nodeWith("reindex", K.Transform{}, [F.portIn("Index")])])])) == True{} : Bool}

# Reindex may not touch a TwinSpec in either direction, so an input port of that type is rejected.
law reindex_reads_spec_red:
  {D.reindexNoSpec(F.kernelG([F.graphOf("pg-adl", [F.nodeWith("reindex", K.Transform{}, [F.portIn("TwinSpec")])])])) == False{} : Bool}

# A kernel with no reindex node is rejected, because the law cannot be checked.
law reindex_absent_red:
  {D.reindexNoSpec(F.kernelG([F.graphOf("pg-adl", [F.xform("other")])])) == False{} : Bool}

# --- INV-CAP-TOKENS, binding half (Laws.BindIntersectsTokens) ---

# core-bind that receives a CapToken[] and emits no tokens is accepted.
law bind_consumes_tokens_green:
  {D.bindIntersectsTokens(F.kernelG([F.graphOf("pg-twin", [F.nodeWith("core-bind", K.Prompt{}, [F.portIn("CapToken[]")])])])) == True{} : Bool}

# core-bind that never receives a CapToken[] has nothing to intersect, so it is rejected.
law bind_no_token_input_red:
  {D.bindIntersectsTokens(F.kernelG([F.graphOf("pg-twin", [F.nodeWith("core-bind", K.Prompt{}, [F.portIn("Other")])])])) == False{} : Bool}

# core-bind may not emit a CapToken[]: binding narrows tokens, it never mints them.
law bind_emits_token_array_red:
  {D.bindIntersectsTokens(F.kernelG([F.graphOf("pg-twin", [F.nodeWith("core-bind", K.Prompt{}, [F.portIn("CapToken[]"), F.portOut("CapToken[]")])])])) == False{} : Bool}

# core-bind may not emit a single CapToken either.
law bind_emits_single_token_red:
  {D.bindIntersectsTokens(F.kernelG([F.graphOf("pg-twin", [F.nodeWith("core-bind", K.Prompt{}, [F.portIn("CapToken[]"), F.portOut("CapToken")])])])) == False{} : Bool}

# Emitting something that is not a token is fine.
law bind_emits_other_green:
  {D.bindIntersectsTokens(F.kernelG([F.graphOf("pg-twin", [F.nodeWith("core-bind", K.Prompt{}, [F.portIn("CapToken[]"), F.portOut("Decision")])])])) == True{} : Bool}

# A kernel with no core-bind node is rejected.
law bind_absent_red:
  {D.bindIntersectsTokens(F.kernelG([F.graphOf("pg-twin", [F.xform("other")])])) == False{} : Bool}

# --- INV-ARCHIVE-KEEPS-LOSERS (Laws.ArchiveKeepsLosers) ---

# register emits a LineageArchive and archive is a transform, so losing lineages are kept.
law archive_keeps_losers_green:
  {D.archiveKeepsLosers(F.kernelG([F.demGood()])) == True{} : Bool}

# If archive is a prompt, a model could decide what to drop, so it is rejected.
law archive_prompt_red:
  {D.archiveKeepsLosers(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("register", K.Prompt{}, [F.portOut("LineageArchive")]), F.prompt("archive")])])) == False{} : Bool}

# register must emit a LineageArchive.
law register_no_archive_red:
  {D.archiveKeepsLosers(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("register", K.Prompt{}, [F.portOut("Other")]), F.xform("archive")])])) == False{} : Bool}

# Only an OUTPUT of type LineageArchive counts; reading one does not.
law register_reads_archive_red:
  {D.archiveKeepsLosers(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("register", K.Prompt{}, [F.portIn("LineageArchive")]), F.xform("archive")])])) == False{} : Bool}

# A kernel with no archive node is rejected.
law archive_absent_red:
  {D.archiveKeepsLosers(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("register", K.Prompt{}, [F.portOut("LineageArchive")])])])) == False{} : Bool}

# --- INV-EVAL-HIDDEN (Laws.EvalHidden) ---

# validate (in pg-dem) and holdout (in pg-adl) are both transforms, so no model can see the evaluation.
law eval_hidden_green:
  {D.evalHidden(F.kernelG([F.graphOf("pg-dem", [F.xform("validate")]), F.graphOf("pg-adl", [F.xform("holdout")])])) == True{} : Bool}

# A validate node that is a prompt is rejected.
law eval_validate_prompt_red:
  {D.evalHidden(F.kernelG([F.graphOf("pg-dem", [F.prompt("validate")]), F.graphOf("pg-adl", [F.xform("holdout")])])) == False{} : Bool}

# A holdout node that is a prompt is rejected.
law eval_holdout_prompt_red:
  {D.evalHidden(F.kernelG([F.graphOf("pg-dem", [F.xform("validate")]), F.graphOf("pg-adl", [F.prompt("holdout")])])) == False{} : Bool}

# Both nodes must be declared; a kernel with no holdout is rejected.
law eval_holdout_absent_red:
  {D.evalHidden(F.kernelG([F.graphOf("pg-dem", [F.xform("validate")])])) == False{} : Bool}

# holdout must live in pg-adl; the same node in the wrong graph does not count.
law eval_holdout_wrong_graph_red:
  {D.evalHidden(F.kernelG([F.graphOf("pg-dem", [F.xform("validate"), F.xform("holdout")])])) == False{} : Bool}

# --- INV-CUT-CLASSIFY (Laws.CutClassify) ---

# cut-class and cluster (in pg-adl) are both transforms, so partitioning is mechanical.
law cut_classify_green:
  {D.cutClassify(F.kernelG([F.graphOf("pg-adl", [F.xform("cut-class"), F.xform("cluster")])])) == True{} : Bool}

# A cut-class node that is a prompt is rejected.
law cut_class_prompt_red:
  {D.cutClassify(F.kernelG([F.graphOf("pg-adl", [F.prompt("cut-class"), F.xform("cluster")])])) == False{} : Bool}

# A cluster node that is a prompt is rejected.
law cluster_prompt_red:
  {D.cutClassify(F.kernelG([F.graphOf("pg-adl", [F.xform("cut-class"), F.prompt("cluster")])])) == False{} : Bool}

# Both nodes must be declared; a kernel with no cluster is rejected.
law cluster_absent_red:
  {D.cutClassify(F.kernelG([F.graphOf("pg-adl", [F.xform("cut-class")])])) == False{} : Bool}

# --- INV-PORT-ROUTABLE (Laws.PortRoutable) ---

# A data edge that names both ports needs no guard and is accepted.
law data_edge_routable_green:
  {D.portRoutable(F.kernelG([F.graphE("pg-x", [], [F.edgePorts("out", "in", K.DataEdge{}, "")])])) == True{} : Bool}

# A control edge that names both ports and carries a guard is accepted.
law control_edge_guarded_green:
  {D.portRoutable(F.kernelG([F.graphE("pg-x", [], [F.edgePorts("out", "in", K.ControlEdge{}, "score >= tau")])])) == True{} : Bool}

# A control edge with no guard is rejected: a scheduler could not decide when to fire it.
law control_edge_unguarded_red:
  {D.portRoutable(F.kernelG([F.graphE("pg-x", [], [F.edgePorts("out", "in", K.ControlEdge{}, "")])])) == False{} : Bool}

# An edge with no source port name is rejected, because the scheduler cannot route from it.
law edge_no_from_port_red:
  {D.portRoutable(F.kernelG([F.graphE("pg-x", [], [F.edgePorts("", "in", K.DataEdge{}, "")])])) == False{} : Bool}

# An edge with no target port name is rejected for the same reason.
law edge_no_to_port_red:
  {D.portRoutable(F.kernelG([F.graphE("pg-x", [], [F.edgePorts("out", "", K.DataEdge{}, "")])])) == False{} : Bool}

# A kernel with no edges has nothing to route, so it passes trivially.
law no_edges_routable_green:
  {D.portRoutable(F.kernelG([])) == True{} : Bool}

# One bad edge among good ones sinks the whole kernel.
law one_bad_edge_red:
  {D.portRoutable(F.kernelG([F.graphE("pg-x", [], [F.edgePorts("out", "in", K.DataEdge{}, ""), F.edgePorts("", "in", K.DataEdge{}, "")])])) == False{} : Bool}

# --- INV-AUDIT-NOT-GATE (Laws.AuditNotGate) ---

# Audit heuristics and sample-clean are transforms, and nothing in pg-audit
# emits a permit, effect, twin id, store, LTM or archive, so audit is only advice.
law audit_not_gate_green:
  {D.auditNotGate(F.kernelG([F.auditGood()])) == True{} : Bool}

# An audit node that emits a Permit could grant authority, so it is rejected.
law audit_emits_permit_red:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.xform("audit-heuristics"), F.xform("sample-clean"), F.nodeWith("report", K.Prompt{}, [F.portOut("Permit")])])])) == False{} : Bool}

# An audit node that emits an ExternalEffect could act on the world, so it is rejected.
law audit_emits_effect_red:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.xform("audit-heuristics"), F.xform("sample-clean"), F.nodeWith("report", K.Prompt{}, [F.portOut("ExternalEffect")])])])) == False{} : Bool}

# An audit node that emits a TwinId could install a twin, so it is rejected.
law audit_emits_twin_id_red:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.xform("audit-heuristics"), F.xform("sample-clean"), F.nodeWith("report", K.Prompt{}, [F.portOut("TwinId")])])])) == False{} : Bool}

# An audit node that emits a CoreStore could write Core, so it is rejected.
law audit_emits_core_store_red:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.xform("audit-heuristics"), F.xform("sample-clean"), F.nodeWith("report", K.Prompt{}, [F.portOut("CoreStore")])])])) == False{} : Bool}

# An audit node that emits LTM could write long-term memory, so it is rejected.
law audit_emits_ltm_red:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.xform("audit-heuristics"), F.xform("sample-clean"), F.nodeWith("report", K.Prompt{}, [F.portOut("LTM")])])])) == False{} : Bool}

# An audit node that emits a LineageArchive could rewrite lineage, so it is rejected.
law audit_emits_archive_red:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.xform("audit-heuristics"), F.xform("sample-clean"), F.nodeWith("report", K.Prompt{}, [F.portOut("LineageArchive")])])])) == False{} : Bool}

# Only OUTPUTS matter: an audit node that reads a Permit is fine.
law audit_reads_permit_green:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.xform("audit-heuristics"), F.xform("sample-clean"), F.nodeWith("report", K.Prompt{}, [F.portIn("Permit")])])])) == True{} : Bool}

# audit-heuristics must be a transform, not a model.
law audit_heuristics_prompt_red:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.prompt("audit-heuristics"), F.xform("sample-clean")])])) == False{} : Bool}

# sample-clean must be a transform too: a model that picks which clean prompts
# the steward sees would defeat the audit.
law audit_sample_clean_prompt_red:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.xform("audit-heuristics"), F.prompt("sample-clean")])])) == False{} : Bool}

# sample-clean must be declared; a kernel without it is rejected.
law audit_sample_clean_absent_red:
  {D.auditNotGate(F.kernelG([F.graphOf("pg-audit", [F.xform("audit-heuristics")])])) == False{} : Bool}

# --- The static certificate: the conjunction of every decidable law (Laws.Laws) ---

# A kernel that satisfies all seventeen decidable laws passes the conjunction.
law laws_kernel_green:
  {D.laws(F.lawsKernel()) == True{} : Bool}

# Each of the next seventeen laws takes that lawful kernel, breaks exactly one
# conjunct, and checks the whole conjunction turns red. Together they show that
# `laws` really requires every one of its seventeen parts.

# Breaking well-formedness (a missing core layer) fails the conjunction.
law laws_fail_well_formed:
  {D.laws(F.faultWellFormed()) == False{} : Bool}

# Freezing an id that names no transform node fails the conjunction.
law laws_fail_frozen:
  {D.laws(F.faultFrozen()) == False{} : Bool}

# Making `structural` a prompt fails the conjunction.
law laws_fail_structural:
  {D.laws(F.faultStructural()) == False{} : Bool}

# Dropping the `commit` node from pg-w2l fails the conjunction.
law laws_fail_hybrid:
  {D.laws(F.faultHybrid()) == False{} : Bool}

# Letting the graph author emit an IdentitySnapshot fails the conjunction.
law laws_fail_author:
  {D.laws(F.faultAuthor()) == False{} : Bool}

# Dropping self-upd from pg-core fails the conjunction.
law laws_fail_self_and_auth:
  {D.laws(F.faultSelfAuth()) == False{} : Bool}

# Removing the CapToken port from twin-auth fails the conjunction.
law laws_fail_cap_token:
  {D.laws(F.faultCapToken()) == False{} : Bool}

# Declaring no twins fails the conjunction.
law laws_fail_twin_origin:
  {D.laws(F.faultTwinOrigin()) == False{} : Bool}

# Dropping action-gate from pg-twin fails the conjunction.
law laws_fail_action_gate:
  {D.laws(F.faultActionGate()) == False{} : Bool}

# Removing the proposer's wire to lineage-record fails the conjunction.
law laws_fail_partition:
  {D.laws(F.faultPartition()) == False{} : Bool}

# Giving reindex a TwinSpec port fails the conjunction.
law laws_fail_reindex:
  {D.laws(F.faultReindex()) == False{} : Bool}

# Letting core-bind emit a CapToken[] fails the conjunction.
law laws_fail_bind:
  {D.laws(F.faultBind()) == False{} : Bool}

# Making archive a prompt fails the conjunction.
law laws_fail_archive:
  {D.laws(F.faultArchive()) == False{} : Bool}

# Making validate a prompt fails the conjunction.
law laws_fail_eval:
  {D.laws(F.faultEval()) == False{} : Bool}

# Making cluster a prompt fails the conjunction.
law laws_fail_cut:
  {D.laws(F.faultCut()) == False{} : Bool}

# An edge with no source port name fails the conjunction.
law laws_fail_route:
  {D.laws(F.faultRoute()) == False{} : Bool}

# Letting an audit node emit a Permit fails the conjunction.
law laws_fail_audit:
  {D.laws(F.faultAudit()) == False{} : Bool}
