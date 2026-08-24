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

  it("routes reject verdicts to interrupt with deny immediately before interrupt", () => {
    const denyAppliers: Appliers = {
      "pg-core/id-read": () => ({ snapshot: { values: [] } }),
      "pg-core/value-filter": () => ({ verdict: { kind: "reject", cited_clauses: [] } }),
      "pg-core/interrupt": (_inputs, ctx) => {
        ctx.emit({ type: "core.deny" });
        ctx.emit({ type: "core.interrupt" });
        return { interrupt: { halted: true } };
      },
    };
    const emitter = makeEmitter();
    runGraph(kernel, "pg-core", { core_store: {}, proposal: {} }, denyAppliers, emitter);
    const types = emitter.events.map((e) => (e.type === "edge.fire" ? `fire:${e.edge}` : e.type));
    expect(types).toContain("fire:c5"); // reject edge fires, pass edge does not
    expect(types).not.toContain("fire:c6");
    const deny = emitter.events.findIndex((e) => e.type === "core.deny");
    expect(deny).toBeGreaterThanOrEqual(0);
    // G (core.deny → X core.interrupt): the very next event is interrupt.
    expect(emitter.events[deny + 1]?.type).toBe("core.interrupt");
  });

  it("refuses applier-forged scheduler events", () => {
    const forging: Appliers = {
      "pg-core/id-read": (_inputs, ctx) => {
        ctx.emit({ type: "node.enter", graph: "pg-core", node: "id-read", t: 0 } as never);
        return { snapshot: {} };
      },
    };
    expect(() =>
      runGraph(kernel, "pg-core", { core_store: {} }, forging, makeEmitter()),
    ).toThrow(/scheduler-owned/);
  });
});

describe("cyclically-fed ingress ports (pg-w2l read path)", () => {
  it("seeds query.slots from ingress and terminates when need_more is false", () => {
    const appliers: Appliers = {
      "pg-w2l/query": (inputs) => ({ query: { from: inputs.slots, indexes: ["episodic"] } }),
      "pg-w2l/hybrid": (inputs) => ({
        hits: (inputs.episodic as unknown[]).map((e) => ({ hit: e })),
      }),
      "pg-w2l/rerank": (inputs) => ({ ranked: inputs.hits }),
      "pg-w2l/inject": (inputs) => ({
        slots: { need_more: false, items: inputs.ranked },
      }),
    };
    const emitter = makeEmitter();
    const out = runGraph(
      kernel,
      "pg-w2l",
      {
        slots: [{ id: "slot:q" }],
        identity: { values: [] },
        episodic: [{ id: "ep:1" }],
        semantic: [],
        skills: [],
        structural: [],
      },
      appliers,
      emitter,
    );
    const entered = emitter.events.flatMap((e) => (e.type === "node.enter" ? [e.node] : []));
    expect(entered).toEqual(["query", "hybrid", "rerank", "inject"]);
    expect(out.get("inject")?.slots).toEqual({ need_more: false, items: [{ hit: { id: "ep:1" } }] });
    // w12 is guard-false, so the cycle does not refire and no fuel is spent.
    expect(emitter.events.filter((e) => e.type === "edge.fire" && e.edge === "w12")).toHaveLength(0);
  });
});
