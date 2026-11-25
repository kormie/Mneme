import Base
import ./Kernel.bend as K
import ./Trace.bend as T
import ./WellFormed.bend as W
import ./Decidable.bend as D
import ./Negatives.bend as N
import ./Fixtures.bend as F

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

# Ghost edge: 0.8's ValidTrace ignored edgeFire.
law ghost_edge_red:
  {T.mentionsExist(N.emptyKernel(), N.ghostEdge()) == False{} : Bool}

# --- INV-ATTACKS-RED (Negatives.attacksRed): all five at once. ---

law attacks_red:
  {N.attacksRed() == True{} : Bool}

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

# --- Trace.ValidTrace / mentionsExist (kernel-dependent) ---

law node_in_kernel_green:
  {T.mentionsExist(F.tinyKernel(), T.NodeEnter{"pg-t", "a"}) == True{} : Bool}

law ghost_node_red:
  {T.mentionsExist(F.tinyKernel(), T.NodeEnter{"pg-t", "zz"}) == False{} : Bool}

law ghost_graph_red:
  {T.mentionsExist(F.tinyKernel(), T.NodeExit{"pg-zz", "a"}) == False{} : Bool}

law edge_in_kernel_green:
  {T.mentionsExist(F.tinyKernel(), T.EdgeFire{"e1"}) == True{} : Bool}

# Events that name no node or edge always exist, in every kernel.
law unnamed_event_exists:
  for k: K.Kernel
  {T.mentionsExist(k, T.CorePermit{}) == True{} : Bool}

law valid_trace_green:
  {T.validTrace(F.tinyKernel(), [T.NodeEnter{"pg-t", "a"}, T.EdgeFire{"e1"}, T.NodeExit{"pg-t", "b"}]) == True{} : Bool}

law ghost_in_trace_red:
  {T.validTrace(F.tinyKernel(), [T.NodeEnter{"pg-t", "a"}, T.EdgeFire{"zz9"}]) == False{} : Bool}

law empty_trace_valid:
  for k: K.Kernel
  {T.validTrace(k, []) == True{} : Bool}

# --- INV-G1-ENUMERABLE (WellFormed.WellFormed) ---

law well_formed_green:
  {W.wellFormed(F.wellKernel()) == True{} : Bool}

law no_graphs_red:
  {W.wellFormed(F.noGraphsKernel()) == False{} : Bool}

law duplicate_graph_red:
  {W.wellFormed(F.duplicateGraphKernel()) == False{} : Bool}

law missing_core_layer_red:
  {W.wellFormed(F.kernelOf(F.noCoreLayers(), [F.tinyGraph()])) == False{} : Bool}

law missing_lineage_store_red:
  {W.wellFormed(F.kernelOf(F.noLineageLayers(), [F.tinyGraph()])) == False{} : Bool}

law ill_formed_graph_makes_kernel_red:
  {W.wellFormed(F.kernelOf(F.fullLayers(), [F.badVersionGraph()])) == False{} : Bool}

# --- INV-LAYERS-FOUR (WellFormed.layersFour) ---

law layers_four_green:
  {W.layersFour(F.fullLayers()) == True{} : Bool}

law layers_four_missing_red:
  {W.layersFour(F.noCoreLayers()) == False{} : Bool}

law layers_four_empty_red:
  {W.layersFour([]) == False{} : Bool}

# --- INV-G4-VERSIONED (WellFormed.graphWF) ---

law graph_wf_green:
  {W.graphWF(F.tinyGraph()) == True{} : Bool}

law duplicate_node_red:
  {W.graphWF(F.duplicateNodeGraph()) == False{} : Bool}

law empty_node_id_red:
  {W.graphWF(F.emptyNodeIdGraph()) == False{} : Bool}

law dangling_edge_red:
  {W.graphWF(F.danglingEdgeGraph()) == False{} : Bool}

law bad_version_red:
  {W.graphWF(F.badVersionGraph()) == False{} : Bool}

law short_version_red:
  {W.graphWF(F.shortVersionGraph()) == False{} : Bool}

law versioned_prefix_green:
  {W.versioned("mneme.graph/7") == True{} : Bool}

# --- WellFormed.nodup ---

law nodup_empty_green:
  {W.nodup([]) == True{} : Bool}

law nodup_distinct_green:
  {W.nodup(["a", "b", "c"]) == True{} : Bool}

law nodup_repeat_red:
  {W.nodup(["a", "b", "a"]) == False{} : Bool}

# --- INV-G2-KIND-SPLIT (Laws.FrozenTransforms): frozen ids name transform nodes ---

law frozen_transform_green:
  {D.frozenTransforms(F.kernelFrozen([F.graphOf("pg-dem", [F.xform("validate")])], ["validate"])) == True{} : Bool}

law frozen_nothing_green:
  {D.frozenTransforms(F.kernelFrozen([], [])) == True{} : Bool}

law frozen_found_in_later_graph_green:
  {D.frozenTransforms(F.kernelFrozen([F.graphOf("pg-a", [F.xform("a")]), F.graphOf("pg-b", [F.xform("b")])], ["b"])) == True{} : Bool}

law frozen_prompt_red:
  {D.frozenTransforms(F.kernelFrozen([F.graphOf("pg-dem", [F.prompt("validate")])], ["validate"])) == False{} : Bool}

law frozen_missing_red:
  {D.frozenTransforms(F.kernelFrozen([F.graphOf("pg-dem", [F.xform("validate")])], ["holdout"])) == False{} : Bool}

# --- INV-STRUCTURAL-NO-MODEL (Laws.StructuralIsTransform) ---

law structural_transform_green:
  {D.structuralIsTransform(F.kernelG([F.graphOf("pg-w2l", [F.xform("structural")])])) == True{} : Bool}

law structural_prompt_red:
  {D.structuralIsTransform(F.kernelG([F.graphOf("pg-w2l", [F.prompt("structural")])])) == False{} : Bool}

law structural_absent_red:
  {D.structuralIsTransform(F.kernelG([F.graphOf("pg-w2l", [F.xform("other")])])) == False{} : Bool}

law structural_wrong_graph_red:
  {D.structuralIsTransform(F.kernelG([F.graphOf("pg-dem", [F.xform("structural")])])) == False{} : Bool}

# --- INV-HYBRID-DECLARED (Laws.HybridDeclared) ---

law hybrid_green:
  {D.hybridDeclared(F.kernelG([F.graphOf("pg-w2l", F.hybridNodes())])) == True{} : Bool}

law hybrid_missing_commit_red:
  {D.hybridDeclared(F.kernelG([F.graphOf("pg-w2l", [F.xform("semantic"), F.xform("skill"), F.xform("structural"), F.xform("hybrid"), F.xform("align")])])) == False{} : Bool}

law hybrid_no_graph_red:
  {D.hybridDeclared(F.kernelG([])) == False{} : Bool}

law hybrid_wrong_graph_red:
  {D.hybridDeclared(F.kernelG([F.graphOf("pg-dem", F.hybridNodes())])) == False{} : Bool}

# --- INV-CORE-NOT-DARWINIAN (Laws.AuthorNotCore) ---

law author_green:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("author", K.Prompt{}, [F.portOut("TwinSpec")])])])) == True{} : Bool}

law author_emits_identity_red:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("author", K.Prompt{}, [F.portOut("IdentitySnapshot")])])])) == False{} : Bool}

law author_emits_inclusion_red:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("author", K.Prompt{}, [F.portOut("TwinSpec"), F.portOut("InclusionReport")])])])) == False{} : Bool}

# Only OUT ports count: reading an IdentitySnapshot is fine.
law author_reads_identity_green:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.nodeWith("author", K.Prompt{}, [F.portIn("IdentitySnapshot"), F.portOut("TwinSpec")])])])) == True{} : Bool}

law author_absent_red:
  {D.authorNotCore(F.kernelG([F.graphOf("pg-dem", [F.xform("other")])])) == False{} : Bool}

# --- INV-TWINS-NEVER-WRITE-CORE (Laws.HasSelfAndAuth) ---

law self_and_auth_green:
  {D.hasSelfAndAuth(F.kernelG([F.graphOf("pg-core", [F.xform("self-upd"), F.xform("twin-auth")])])) == True{} : Bool}

law self_and_auth_missing_auth_red:
  {D.hasSelfAndAuth(F.kernelG([F.graphOf("pg-core", [F.xform("self-upd")])])) == False{} : Bool}

law self_and_auth_wrong_graph_red:
  {D.hasSelfAndAuth(F.kernelG([F.graphOf("pg-twin", [F.xform("self-upd"), F.xform("twin-auth")])])) == False{} : Bool}

# --- INV-CAP-TOKENS (Laws.CapTokenPort) ---

law cap_token_port_green:
  {D.capTokenPort(F.kernelG([F.graphOf("pg-core", [F.nodeWith("twin-auth", K.Prompt{}, [F.portOut("CapToken")])])])) == True{} : Bool}

law cap_token_port_any_direction_green:
  {D.capTokenPort(F.kernelG([F.graphOf("pg-core", [F.nodeWith("twin-auth", K.Prompt{}, [F.portIn("CapToken")])])])) == True{} : Bool}

law cap_token_port_absent_red:
  {D.capTokenPort(F.kernelG([F.graphOf("pg-core", [F.nodeWith("twin-auth", K.Prompt{}, [F.portOut("TwinSpec")])])])) == False{} : Bool}

# The type must match exactly: `CapToken[]` is a different type.
law cap_token_array_is_not_cap_token_red:
  {D.capTokenPort(F.kernelG([F.graphOf("pg-core", [F.nodeWith("twin-auth", K.Prompt{}, [F.portOut("CapToken[]")])])])) == False{} : Bool}

# --- INV-SEEDS-NOT-ONTOLOGY (Laws.TwinOrigin) ---

law twin_origin_green:
  {D.twinOrigin(F.kernelTwins([K.Twin{"demo-soma", K.Seed{}}])) == True{} : Bool}

law twin_origin_empty_red:
  {D.twinOrigin(F.kernelTwins([])) == False{} : Bool}

# --- INV-ACTION-GATE (Laws.HasActionGate) ---

law action_gate_green:
  {D.hasActionGate(F.kernelG([F.graphOf("pg-twin", [F.xform("action-gate"), F.xform("core-bind")])])) == True{} : Bool}

law action_gate_missing_bind_red:
  {D.hasActionGate(F.kernelG([F.graphOf("pg-twin", [F.xform("action-gate")])])) == False{} : Bool}

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
