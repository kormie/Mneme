import Base
import ./LAWS.bend as Laws

def Laws.silent_install_red():
  {==}

def Laws.ack_replay_red():
  {==}

def Laws.amortized_permit_red():
  {==}

def Laws.audit_does_not_consume_red():
  {==}

def Laws.ghost_edge_red():
  {==}

def Laws.attacks_red():
  {==}

def Laws.acked_install_green():
  {==}

def Laws.lone_install_red(x):
  {==}

def Laws.permit_then_write_green():
  {==}

def Laws.write_without_permit_red():
  {==}

def Laws.deny_flushes_permit_red():
  {==}

def Laws.inbox_needs_no_permit_green():
  {==}

def Laws.inbox_does_not_consume_permit_green():
  {==}

def Laws.deny_then_interrupt_green():
  {==}

def Laws.deny_without_interrupt_red():
  {==}

def Laws.trailing_deny_red():
  {==}

def Laws.propose_then_install_red(x):
  {==}

def Laws.propose_gap_install_green():
  {==}

def Laws.installed_twin_write_green():
  {==}

def Laws.uninstalled_twin_write_red(s, t):
  {==}

def Laws.other_twin_install_red():
  {==}

def Laws.cluster_cut_green():
  {==}

def Laws.no_cluster_cut_red():
  {==}

def Laws.archive_sample_green():
  {==}

def Laws.no_archive_sample_red():
  {==}

def Laws.node_enter_green():
  {==}

def Laws.empty_schedule_red():
  {==}

def Laws.audit_then_permit_red():
  {==}

def Laws.audit_then_install_red():
  {==}

def Laws.audit_then_inbox_write_green():
  {==}

def Laws.audit_then_ltm_write_red():
  {==}

def Laws.leaving_audit_green():
  {==}

def Laws.staying_in_audit_red():
  {==}

def Laws.node_in_kernel_green():
  {==}

def Laws.ghost_node_red():
  {==}

def Laws.ghost_graph_red():
  {==}

def Laws.edge_in_kernel_green():
  {==}

def Laws.unnamed_event_exists(k):
  {==}

def Laws.valid_trace_green():
  {==}

def Laws.ghost_in_trace_red():
  {==}

def Laws.empty_trace_valid(k):
  {==}

def Laws.well_formed_green():
  {==}

def Laws.no_graphs_red():
  {==}

def Laws.duplicate_graph_red():
  {==}

def Laws.missing_core_layer_red():
  {==}

def Laws.missing_lineage_store_red():
  {==}

def Laws.ill_formed_graph_makes_kernel_red():
  {==}

def Laws.layers_four_green():
  {==}

def Laws.layers_four_missing_red():
  {==}

def Laws.layers_four_empty_red():
  {==}

def Laws.graph_wf_green():
  {==}

def Laws.duplicate_node_red():
  {==}

def Laws.empty_node_id_red():
  {==}

def Laws.dangling_edge_red():
  {==}

def Laws.bad_version_red():
  {==}

def Laws.short_version_red():
  {==}

def Laws.versioned_prefix_green():
  {==}

def Laws.nodup_empty_green():
  {==}

def Laws.nodup_distinct_green():
  {==}

def Laws.nodup_repeat_red():
  {==}

def Laws.frozen_transform_green():
  {==}

def Laws.frozen_nothing_green():
  {==}

def Laws.frozen_found_in_later_graph_green():
  {==}

def Laws.frozen_prompt_red():
  {==}

def Laws.frozen_missing_red():
  {==}

def Laws.structural_transform_green():
  {==}

def Laws.structural_prompt_red():
  {==}

def Laws.structural_absent_red():
  {==}

def Laws.structural_wrong_graph_red():
  {==}

def Laws.hybrid_green():
  {==}

def Laws.hybrid_missing_commit_red():
  {==}

def Laws.hybrid_no_graph_red():
  {==}

def Laws.hybrid_wrong_graph_red():
  {==}

def Laws.author_green():
  {==}

def Laws.author_emits_identity_red():
  {==}

def Laws.author_emits_inclusion_red():
  {==}

def Laws.author_reads_identity_green():
  {==}

def Laws.author_absent_red():
  {==}

def Laws.self_and_auth_green():
  {==}

def Laws.self_and_auth_missing_auth_red():
  {==}

def Laws.self_and_auth_wrong_graph_red():
  {==}

def Laws.cap_token_port_green():
  {==}

def Laws.cap_token_port_any_direction_green():
  {==}

def Laws.cap_token_port_absent_red():
  {==}

def Laws.cap_token_array_is_not_cap_token_red():
  {==}

def Laws.twin_origin_green():
  {==}

def Laws.twin_origin_empty_red():
  {==}

def Laws.action_gate_green():
  {==}

def Laws.action_gate_missing_bind_red():
  {==}

def Laws.action_gate_wrong_graph_red():
  {==}
