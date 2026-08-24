import { describe, expect, it } from "vitest";
import { loadKernel } from "../src/kernel.js";

/**
 * Smoke tests only. These assert the loader reads the canonical pack,
 * not that the kernel satisfies the laws — that is judge's job
 * (untrusted, ADR-008) and ultimately Lean's.
 */
describe("kernel IR loader", () => {
  const k = loadKernel();

  it("loads the canonical 0.10 pack", () => {
    expect(k.spec).toBe("mneme.spec/0.10");
  });

  it("has four layers (INV-LAYERS-FOUR shape, not proof)", () => {
    expect(k.layers.map((l) => l.id)).toEqual([
      "sensory",
      "working",
      "longterm",
      "core",
    ]);
  });

  it("has the seven graphs", () => {
    expect(k.graphs.map((g) => g.id).sort()).toEqual(
      ["pg-adl", "pg-audit", "pg-core", "pg-dem", "pg-s2w", "pg-twin", "pg-w2l"].sort(),
    );
  });

  it("has the four twin seeds and seven frozen surfaces", () => {
    expect(k.twins.map((t) => t.id).sort()).toEqual(
      ["agora", "nomos", "oikos", "soma"].sort(),
    );
    expect(k.frozen).toHaveLength(7);
  });

  it("every prompt node references a prompt file in the pack (ADR-015)", () => {
    for (const g of k.graphs) {
      for (const n of g.nodes) {
        if (n.kind === "prompt") {
          expect(n.promptRef, `${g.id}/${n.id} missing promptRef`).toBeTruthy();
        }
      }
    }
  });
});
