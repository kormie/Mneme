import Base
import ./Mneme.bend as M

# Human-written claims. The AI does not touch this file.
# Lean counterparts: silentInstall_red, ackReplay_red (spec/lean/Negatives.lean).

law silent_install_red:
  {M.installRequiresAck(M.silentInstall()) == False{} : Bool}

law ack_replay_red:
  {M.installRequiresAck(M.ackReplay()) == False{} : Bool}

law acked_install_green:
  {M.installRequiresAck(M.acked()) == True{} : Bool}

# Stronger than `decide`: holds for every id, not one instance.
law lone_install_red:
  for x: String
  {M.installRequiresAck([M.TwinInstall{x}]) == False{} : Bool}
