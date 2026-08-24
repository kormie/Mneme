import Mneme.Kernel
import Mneme.WellFormed
import Mneme.Laws
import Mneme.Trace

namespace Mneme

/-!
Fully compliant is an inhabitant of `Certificate` (static) or
`RuntimeCertificate` (static + G3).

The TypeScript `judge` is an *untrusted* decision procedure for the same
Bool predicates. Passing `judge` is not a proof.

Empirical metrics (holdout, archive diversity, compile scores) are not
fields of these structures. They cannot be. That is ADR-008.

`native_decide` is a compiler fast path. It is not the artifact.
Fully compliant is `pureRuntimeCert`-shaped: `by decide`, `#print axioms` empty.
-/

/-- Static fully-compliant gate. Decidable laws only. -/
structure Certificate where
  kernel : Kernel
  laws : Laws kernel

/-- Runtime fully-compliant gate. Certificate plus a trace inhabiting Temporal. -/
structure RuntimeCertificate where
  cert : Certificate
  trace : List Event
  temporal : Temporal cert.kernel trace

/-- Judged (untrusted) vs certified. A judged kernel with skip-on-trace
    is the sketch. Fully compliant is a value of these types, kernel-checked. -/
inductive Gate where
  | judged
  | certifiedStatic
  | certifiedRuntime

def Gate.fullyCompliant : Gate → Bool
  | .judged => false
  | .certifiedStatic => false
  | .certifiedRuntime => true

end Mneme

