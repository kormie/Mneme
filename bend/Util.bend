import Base

# Lean: `xs.any (· == x)` over strings. Shared by Trace and WellFormed.
def mem(+xs: List<&2, String>, +x: String) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{h, t}:
      (String.eq(h, x) || mem(t, x))
