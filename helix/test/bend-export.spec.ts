import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { loadKernel } from "../src/kernel.js";
import { projectKernel } from "../src/lean-kernel.js";
import {
  KERNEL_IR_BEND_PATH,
  graphDefName,
  renderKernelBend,
} from "../src/bend-export.js";

const proj = projectKernel(loadKernel());

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("bend export parity", () => {
  it("regenerating bend/KernelIR.bend is byte-identical to the committed file", () => {
    const committed = readFileSync(KERNEL_IR_BEND_PATH, "utf8");
    expect(renderKernelBend(proj)).toBe(committed);
  });

  it("the projection carries structure only — no prompt bodies, hashes, or signatures", () => {
    // The header comment names the dropped fields; only the code must not carry them.
    const code = renderKernelBend(proj)
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .join("\n");
    expect(code).not.toContain("bodyHash");
    expect(code).not.toContain("signature");
    expect(code).not.toContain("promptRef");
    expect(code).not.toContain("fnv1a:");
    expect(code).not.toContain("prompts/");
    expect(code).toContain("def kernel() -> K.Kernel:");
  });

  it("emits every node, edge, graph, twin and frozen id the projection holds", () => {
    const rendered = renderKernelBend(proj);
    const nodes = proj.graphs.reduce((n, g) => n + g.nodes.length, 0);
    const edges = proj.graphs.reduce((n, g) => n + g.edges.length, 0);
    const ports = proj.graphs.reduce(
      (n, g) => n + g.nodes.reduce((m, node) => m + node.ports.length, 0),
      0,
    );
    expect(count(rendered, "K.Node{")).toBe(nodes);
    expect(count(rendered, "K.Edge{")).toBe(edges);
    expect(count(rendered, "K.Port{")).toBe(ports);
    expect(count(rendered, "K.Graph{")).toBe(proj.graphs.length);
    expect(count(rendered, "K.Twin{")).toBe(proj.twins.length);
    expect(count(rendered, "K.Layer{")).toBe(proj.layers.length);
    for (const id of proj.frozen) expect(rendered).toContain(`"${id}"`);
  });

  it("emits the graphs in kernel order, one def each", () => {
    const rendered = renderKernelBend(proj);
    const order = proj.graphs.map((g) => rendered.indexOf(`def ${graphDefName(g.id)}()`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("fails closed on a string Bend's escaping rules were never checked against", () => {
    for (const bad of ['a"b', "a\\b", "a\nb", "café"]) {
      const poisoned = structuredClone(proj);
      poisoned.frozen = [bad];
      expect(() => renderKernelBend(poisoned)).toThrow("unsupported character");
    }
  });

  it("refuses a graph id that cannot name a Bend def, and a duplicate graph id", () => {
    expect(() => graphDefName("Pg Bad")).toThrow("cannot name a Bend def");
    const clash = structuredClone(proj);
    clash.graphs.push({ ...structuredClone(clash.graphs[0]!), id: "pg-s2w" });
    expect(() => renderKernelBend(clash)).toThrow("same Bend def name");
  });
});
