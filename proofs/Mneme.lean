-- Root module for the certified fragment of mneme.spec/0.10.
-- Module sources are generated into Mneme/ from spec/lean/ by
-- scripts/sync-lean.sh. Never edit the generated files or spec/lean/.
--
-- Mneme.Negatives is deliberately NOT imported: its final theorem
-- (attacksRed, line 55) fails Decidable synthesis as shipped in 0.10.
-- See SPEC ISSUE #1 in CLAUDE.md and proofs/Regressions.lean for the
-- bridge. When 0.11 fixes it: add `import Mneme.Negatives` back and
-- delete Regressions.
import Mneme.Kernel
import Mneme.WellFormed
import Mneme.Laws
import Mneme.Trace
import Mneme.Certified
