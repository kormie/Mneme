import { describe, expect, it } from "bun:test";
import { loadKernel } from "../src/kernel.js";
import {
  BEND_BATCH,
  COLUMNS,
  KERNEL_PREDICATES,
  TRACE_COLUMNS,
  TRACE_PREDICATES,
  bendBatches,
  buildCorpus,
  renderBend,
  renderLean,
  tsKernelRow,
  tsTraceRow,
} from "../src/differential-gen.js";
import { compare, parseRows } from "../src/differential.js";

const ir = loadKernel();
const { corpus, base } = buildCorpus(ir);

describe("differential corpus", () => {
  it("is deterministic for a seed and changes with it", () => {
    const again = buildCorpus(ir).corpus;
    expect(JSON.stringify(again)).toBe(JSON.stringify(corpus));
    const other = buildCorpus(ir, { seed: 1 }).corpus;
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(corpus));
  });

  it("gives every case a unique id", () => {
    const ids = [...corpus.kernels.map((k) => k.id), ...corpus.traces.map((t) => t.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts from the real kernel: the unmutated case satisfies every law", () => {
    const row = tsKernelRow(corpus.kernels.find((k) => k.id === "k_base")!.kernel);
    expect(row).toEqual(COLUMNS.map(() => "1"));
  });

  it("exercises both outcomes of every kernel predicate", () => {
    const rows = corpus.kernels.map((k) => tsKernelRow(k.kernel));
    COLUMNS.forEach((name, i) => {
      const falses = rows.filter((r) => r[i] === "0").length;
      const trues = rows.filter((r) => r[i] === "1").length;
      // A predicate never seen to fail is one the comparison has not tested.
      expect({ name, falses: falses >= 3 }).toEqual({ name, falses: true });
      expect({ name, trues: trues >= 3 }).toEqual({ name, trues: true });
    });
  });

  it("exercises both outcomes of every trace predicate", () => {
    const rows = corpus.traces.map((t) => tsTraceRow(t.events, ir));
    TRACE_COLUMNS.forEach((name, i) => {
      const falses = rows.filter((r) => r[i] === "0").length;
      const trues = rows.filter((r) => r[i] === "1").length;
      expect({ name, falses: falses >= 5 }).toEqual({ name, falses: true });
      expect({ name, trues: trues >= 5 }).toEqual({ name, trues: true });
    });
  });

  it("aims guided kernels at the law they are named for", () => {
    const guided = corpus.kernels.filter((k) => k.id.startsWith("g_"));
    expect(guided.length).toBeGreaterThan(0);
    for (const k of guided) {
      const name = k.id.split("_")[1]!;
      const p = KERNEL_PREDICATES.find((x) => x.name === name)!;
      expect(p.ts(k.kernel)).toBe(false);
    }
  });

  it("always includes the five ADR-014 attacks, red under their predicates", () => {
    const row = (id: string): Record<string, string> => {
      const t = corpus.traces.find((x) => x.id === id)!;
      const bits = tsTraceRow(t.events, ir);
      return Object.fromEntries(TRACE_COLUMNS.map((c, i) => [c, bits[i]!]));
    };
    expect(row("t_silent_install").installRequiresAck).toBe("0");
    expect(row("t_ack_replay").installRequiresAck).toBe("0");
    expect(row("t_amortized_permit").commitAfterPermit).toBe("0");
    expect(row("t_ghost_edge").validTrace).toBe("0");
    expect(row("t_audit_does_not_consume").commitAfterPermit).toBe("0");
    expect(row("t_acked_install").installRequiresAck).toBe("1");
  });
});

describe("differential rendering", () => {
  it("renders every case into the Lean file and into exactly one Bend batch", () => {
    const lean = renderLean(corpus, base);
    for (const k of corpus.kernels) expect(lean).toContain(`kreport "${k.id}" c_${k.id}`);
    for (const t of corpus.traces) expect(lean).toContain(`treport "${t.id}" t_${t.id}`);
    expect(lean).toContain("#eval IO.println");

    const batches = bendBatches(corpus);
    const seen = batches.flatMap((b) => [...b.kernels.map((k) => k.id), ...b.traces.map((t) => t.id)]);
    const all = [...corpus.kernels.map((k) => k.id), ...corpus.traces.map((t) => t.id)];
    expect(seen.sort()).toEqual(all.sort());
    for (const b of batches) {
      expect(b.kernels.length + b.traces.length).toBeLessThanOrEqual(BEND_BATCH);
      const text = renderBend(b, base);
      expect(text).toContain("def main() -> String:");
      for (const k of b.kernels) expect(text).toContain(`kreport("${k.id}", c_${k.id}())`);
    }
  });

  it("shares graphs between kernels instead of repeating them", () => {
    const lean = renderLean(corpus, base);
    const graphDefs = lean.split("\n").filter((l) => l.startsWith("def g")).length;
    const kernelDefs = lean.split("\n").filter((l) => /^def c_k/.test(l)).length;
    // Seven real graphs plus the few each mutant changes: far fewer than 7 per kernel.
    expect(graphDefs).toBeLessThan(kernelDefs * 3);
  });

  it("fails closed on a string it cannot render safely", () => {
    const bad = structuredClone(corpus);
    bad.kernels[0]!.kernel.frozen = ['a"b'];
    expect(() => renderLean(bad, base)).toThrow("unsupported character");
    expect(() => renderBend(bad, base)).toThrow("unsupported character");
  });
});

describe("differential comparison", () => {
  const tiny = {
    kernels: [{ id: "k1", kernel: base, how: ["x"] }],
    traces: [{ id: "t1", events: [] }],
  };
  const kbits = (b: string): string[] => COLUMNS.map(() => b);
  const tbits = (b: string): string[] => TRACE_PREDICATES.map(() => b);
  const rows = (kb: string, tb: string): Map<string, string[]> =>
    new Map([["k1", kbits(kb)], ["t1", tbits(tb)]]);

  it("reports no divergence when all three agree", () => {
    const r = compare(tiny, rows("1", "1"), rows("1", "1"), rows("1", "1"));
    expect(r.divergences).toEqual([]);
    expect(r.comparisons).toBe(2 * (COLUMNS.length + TRACE_COLUMNS.length));
  });

  it("names the case, predicate and implementation that disagrees with Lean", () => {
    const bend = rows("1", "1");
    bend.get("k1")![3] = "0";
    const ts = rows("1", "1");
    ts.get("t1")![0] = "0";
    const { divergences } = compare(tiny, rows("1", "1"), bend, ts);
    expect(divergences.map((d) => [d.id, d.column, d.against])).toEqual([
      ["k1", COLUMNS[3]!, "bend"],
      ["t1", TRACE_COLUMNS[0]!, "ts"],
    ]);
  });

  it("refuses a missing row or a short row rather than passing quietly", () => {
    const missing = rows("1", "1");
    missing.delete("t1");
    expect(() => compare(tiny, rows("1", "1"), missing, rows("1", "1"))).toThrow("no row for t1");
    const short = rows("1", "1");
    short.set("k1", ["1"]);
    expect(() => compare(tiny, rows("1", "1"), short, rows("1", "1"))).toThrow("columns");
  });

  it("parses id-then-bits lines and ignores blank ones", () => {
    const parsed = parseRows("k1 1 0 1\n\nt1 0 0\n");
    expect(parsed.get("k1")).toEqual(["1", "0", "1"]);
    expect(parsed.get("t1")).toEqual(["0", "0"]);
    expect(parsed.size).toBe(2);
  });
});
