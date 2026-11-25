/**
 * Coverage parity between the Lean pack and the Bend verification layer.
 *
 * This does not run Bend (the `bend` CI job does). It checks, from the
 * committed sources alone, that Bend ports everything Lean states: if a
 * future spec pack adds a law, a predicate, or an attack trace, this fails
 * until bend/ catches up. It also enforces the house rule that every law in
 * bend/LAWS.bend has a plain-English comment directly above it.
 *
 * Coverage is not agreement. Lean stays the certificate of record.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

const lawsBend = read("bend/LAWS.bend");
const proofBend = read("bend/PROOF.bend");
const kernelIRLean = read("proofs/KernelIR.lean");

/** camelCase -> snake_case: `partitionProposeNoInstall` -> `partition_propose_no_install`. */
function snake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function lawNames(src: string): string[] {
  return [...src.matchAll(/^law (\w+):/gm)].map((m) => m[1]!);
}

/** Lean defs that Bend deliberately names differently. Keep this list short. */
const RENAMED: Record<string, string> = {
  // Lean says "are transforms", Bend says "transforms"; same predicate.
  frozenAreTransforms: "frozenTransforms",
};

/** The Bend name for a Lean `def`: drop a trailing `B`, apply renames. */
function bendName(leanDef: string): string {
  const base = leanDef.endsWith("B") ? leanDef.slice(0, -1) : leanDef;
  return RENAMED[base] ?? base;
}

function lowerDefs(leanSrc: string): string[] {
  return [...leanSrc.matchAll(/^def ([a-z]\w*)\b/gm)].map((m) => m[1]!);
}

function bendDefs(bendSrc: string): Set<string> {
  return new Set([...bendSrc.matchAll(/^def ([\w.]+)\(/gm)].map((m) => m[1]!));
}

describe("bend law comments", () => {
  it("every law in LAWS.bend has a plain-English comment directly above it", () => {
    const lines = lawsBend.split("\n");
    const bare: string[] = [];
    lines.forEach((line, i) => {
      const m = /^law (\w+):/.exec(line);
      if (!m) return;
      const above = lines[i - 1] ?? "";
      if (!above.startsWith("#") || above.startsWith("# ---")) bare.push(m[1]!);
    });
    expect(bare).toEqual([]);
  });

  it("every law has a proof, and every proof has a law", () => {
    const laws = new Set(lawNames(lawsBend));
    const proofs = new Set(
      [...proofBend.matchAll(/^def Laws\.(\w+)\(/gm)].map((m) => m[1]!),
    );
    expect([...laws].filter((n) => !proofs.has(n))).toEqual([]);
    expect([...proofs].filter((n) => !laws.has(n))).toEqual([]);
  });
});

describe("bend covers the Lean pack", () => {
  it("proves every KernelIR conjunct, in Lean's order, and the assembled certificate", () => {
    const leanConjuncts = [...kernelIRLean.matchAll(/^theorem kernel_(\w+) : \w+ kernel :=/gm)]
      .map((m) => m[1]!)
      .filter((name) => name !== "laws");
    expect(leanConjuncts.length).toBe(17);
    const laws = new Set(lawNames(lawsBend));
    for (const c of leanConjuncts) expect(laws.has(`kernel_${snake(c)}`)).toBe(true);
    expect(laws.has("kernel_laws")).toBe(true);

    // `kernel_laws` hands the per-conjunct proofs to `laws_of_parts` in the
    // same order as Lean's anonymous constructor `⟨kernel_wellFormed, ...⟩`.
    const bendOrder = [
      ...proofBend
        .slice(proofBend.indexOf("def Laws.kernel_laws()"))
        .matchAll(/Laws\.kernel_(\w+)\(\)/g),
    ]
      .map((m) => m[1]!)
      .filter((name) => name !== "laws"); // the def's own name
    expect(bendOrder).toEqual(leanConjuncts.map(snake));
  });

  it("mirrors the five ADR-014 negatives and their conjunction", () => {
    const negatives = [...read("spec/lean/Negatives.lean").matchAll(/^theorem (\w+)_red\b/gm)].map(
      (m) => m[1]!,
    );
    expect(negatives.length).toBe(5);
    const laws = new Set(lawNames(lawsBend));
    for (const n of negatives) expect(laws.has(`${snake(n)}_red`)).toBe(true);
    expect(laws.has("attacks_red")).toBe(true);
  });

  it("defines every Lean predicate in the matching Bend module", () => {
    const modules: [lean: string, bend: string][] = [
      ["spec/lean/Trace.lean", "bend/Trace.bend"],
      ["spec/lean/Laws.lean", "bend/Decidable.bend"],
      ["spec/lean/WellFormed.lean", "bend/WellFormed.bend"],
    ];
    const missing: string[] = [];
    for (const [leanPath, bendPath] of modules) {
      const have = bendDefs(read(bendPath));
      for (const d of lowerDefs(read(leanPath))) {
        if (!have.has(bendName(d))) missing.push(`${leanPath} ${d} -> ${bendName(d)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
