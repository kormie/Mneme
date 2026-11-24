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
