# bend/

A second, independent check of the MNEME static laws, written in
[Bend](https://bend-lang.com). It ports `spec/lean/` and proves the same
laws over the same kernel IR. **Lean stays the certificate of record**
(AGENTS.md law 6, ADR-008): a Bend result is evidence, not a certificate.
Replacing Lean as the certifier is a steward decision and needs a new spec
pack; nothing here changes that.

## Check it

```sh
cd bend && bend PROOF.bend             # ALL PROOFS CHECK
cd bend && bend PROOF.bend --verdict   # recheck with Bend's Lean-proven kernel (~20 s)
```

Run `bend PROOF.bend` before committing Bend changes.

`./scripts/install-bend.sh` installs the pinned release (`bend/.bend-version`)
with its sha256 checked, into `~/.bend`. CI's `bend laws` job runs the same
script, then both commands above. To bump the pin, change `.bend-version` and
add the new release's sha256s to the script (copy them from
`https://bend-lang.com/install.sh`).

## What CI checks, and what it does not

- The `bend laws` job runs `bend PROOF.bend` and `--verdict`.
- `helix/test/bend-parity.spec.ts` (in the `helix` job) checks coverage from
  the sources alone: every `kernel_*` theorem in `proofs/KernelIR.lean` has a
  Bend law, in Lean's order; every ADR-014 negative has one; every Lean
  predicate in `Trace`, `Laws` and `WellFormed` has a Bend def; and every law
  has a plain-English comment. If a new spec pack adds a law, this fails until
  `bend/` ports it.
- `helix/test/bend-export.spec.ts` keeps `KernelIR.bend` byte-identical to the
  generator's output.

Coverage is not agreement: these checks show Bend states what Lean states, and
that Bend's proofs hold, not that every Bend predicate computes exactly what
its Lean twin does on every input. Lean stays the certificate of record.

## Layout

Each module mirrors a file in `spec/lean/`; every def names its Lean
counterpart. Modules mirror, never extend.

| File | Mirrors | Holds |
|---|---|---|
| `Kernel.bend` | `Kernel.lean` | IR types, node/graph/edge finders, port queries |
| `Trace.bend` | `Trace.lean` | trace events and the temporal predicates |
| `WellFormed.bend` | `WellFormed.lean` | the G1/G4 gate |
| `Decidable.bend` | `Laws.lean` | the sixteen decidable laws and `laws`, their conjunction |
| `Negatives.bend` | `Negatives.lean` | the five ADR-014 attack traces and `attacksRed` |
| `Util.bend` | none | shared string membership |
| `Fixtures.bend` | none | small hand-built kernels for green and red controls |
| `KernelIR.bend` | `proofs/KernelIR.lean` | the real kernel, **generated** |
| `LAWS.bend` | | the claims. Every law has a plain-English comment above it |
| `PROOF.bend` | | the proofs, one `def Laws.<name>` per law |

Bend reads `LAWS.bend` and `PROOF.bend` as a pair: `bend PROOF.bend` prints
SOME PROOFS FAIL while any law is open or false. The file is named
`Decidable.bend`, not `Laws.bend`, because the default macOS filesystem is
case-insensitive and `LAWS.bend` would collide.

## KernelIR.bend is generated

`KernelIR.bend` is the Bend counterpart of `proofs/KernelIR.lean`: the
projection of `spec/kernel.json` onto `Kernel.bend`'s types, written by

```sh
cd helix && bun src/bend-export.ts
```

`helix/test/bend-export.spec.ts` regenerates it and fails on any byte of
drift, so never edit it by hand. It uses the same `projectKernel` view as the
Lean exporter, so both sides see the same IR. The real-kernel laws are the
`kernel_*` laws in `LAWS.bend`; `kernel_laws` is assembled from them by
`laws_of_parts`, the analogue of the anonymous constructor in
`KernelIR.kernel_laws`. Assembling it that way, instead of evaluating the
whole conjunction at once, keeps it within the fuel of the proven kernel.

## Writing laws

- Say what each law claims, in plain English, in a comment directly above it.
- A "red" law checks that a predicate rejects something; a "green" law checks
  it accepts something. Pair them, so a predicate that always says no cannot
  pass.
- Bend cannot `match` on a computed value, and it bans mutual recursion. Pass
  the computed value to a helper that matches on its parameter, and put the
  helper above its caller (defs are checked in file order).
- Mutate the predicate once you have a law: it should fail. If it does not,
  the law is not testing what you think.
