import { describe, expect, it } from "vitest";
import { loadKernel } from "../src/kernel.js";
import { evalGuard, makeEmitter, runGraph, type Appliers } from "../src/scheduler.js";

const kernel = loadKernel();

describe("guard evaluation", () => {
  it("evaluates the kernel's guard shapes over port values", () => {
    expect(evalGuard("flag != null", "flag", null)).toBe(false);
    expect(evalGuard("flag != null", "flag", { clause: "c1" })).toBe(true);
    expect(evalGuard("verdict.kind == pass", "verdict", { kind: "pass" })).toBe(true);
    expect(evalGuard("verdict.kind == pass", "verdict", { kind: "reject" })).toBe(false);
    expect(evalGuard("ack.rehearse == true", "ack", { rehearse: false })).toBe(false);
    expect(evalGuard("permit.allowed == false", "permit", { allowed: false })).toBe(true);
    expect(evalGuard("kind != partition", "kind", "abstraction")).toBe(true);
    expect(evalGuard("true", "anything", null)).toBe(true);
  });

  it("refuses guards it cannot resolve instead of branching silently", () => {
    expect(() => evalGuard("score < tau", "verdict", { kind: "pass" })).toThrow();
    expect(() => evalGuard("do whatever", "x", 1)).toThrow();
    expect(() => evalGuard("score < tau", "score", 0.5)).toThrow(/non-numbers/);
  });
});

describe("runGraph on pg-core", () => {
  const appliers: Appliers = {
    "pg-core/id-read": (inputs) => ({
      snapshot: { values: [], from: inputs.core_store },
    }),
    "pg-core/value-filter": (_inputs, ctx) => {
      ctx.emit({ type: "core.permit" });
      return { verdict: { kind: "pass", cited_clauses: [] } };
    },
  };

  it("routes declared edges only and skips guard-false control edges", () => {
    const emitter = makeEmitter();
    runGraph(kernel, "pg-core", { core_store: {}, proposal: { store: "episodic" } }, appliers, emitter);
    const kinds = emitter.events.map((e) =>
      e.type === "edge.fire" ? `fire:${e.edge}` : e.type === "node.enter" ? `enter:${e.node}` : e.type,
    );
    // id-read then value-filter; snapshot fans out on c1–c4; the pass
    // verdict routes on c6, never on the reject edge c5.
    expect(kinds).toEqual([
      "enter:id-read",
      "node.exit",
      "fire:c1",
      "fire:c2",
      "fire:c3",
      "fire:c4",
      "enter:value-filter",
      "core.permit",
      "node.exit",
      "fire:c6",
    ]);
    // goal, twin-auth, self-upd, interrupt, core-write lack required
    // inputs and never run.
    const entered = emitter.events.filter((e) => e.type === "node.enter");
    expect(entered.map((e) => e.type === "node.enter" && e.node)).toEqual([
      "id-read",
      "value-filter",
    ]);
  });

  it("rejects ingress names the kernel does not declare", () => {
    expect(() =>
      runGraph(kernel, "pg-core", { invented: 1 }, appliers, makeEmitter()),
    ).toThrow(/not declared/);
  });

  it("rejects unknown graphs and missing appliers", () => {
    expect(() => runGraph(kernel, "pg-nope", {}, appliers, makeEmitter())).toThrow(
      /unknown graph/,
    );
    expect(() =>
      runGraph(kernel, "pg-core", { core_store: {}, proposal: {} }, {}, makeEmitter()),
    ).toThrow(/no applier/);
  });
});
