import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { loadKernel } from "../src/kernel.js";
import { projectKernel } from "../src/lean-kernel.js";
import * as laws from "../src/laws.js";
import {
  attemptRuntimeRun,
  judge,
  runAttacks,
  supplementaryTemporal,
} from "../src/judge.js";
import { renderKernelIR, KERNEL_IR_LEAN_PATH } from "../src/lean-export.js";
import { runTray } from "../src/tray.js";
import {
  hasArchiveSample,
  hasClusterCut,
  installRequiresAck,
  proposeNotInstall,
  twinIdRequiresInstall,
  type TraceEvent,
} from "../src/trace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../fixtures/tray");
const kernel = loadKernel();
const proj = projectKernel(kernel);

describe("judge: kernel fold over spec/inhabitants.md", () => {
  const j = judge(kernel);

  it("covers all 28 inhabitants: 27 rows plus INV-ATTACKS-RED", () => {
    expect(j.rows).toHaveLength(27);
    expect(j.rows.filter((r) => r.kind === "decidable")).toHaveLength(19);
    expect(j.rows.filter((r) => r.kind === "temporal")).toHaveLength(8);
  });

  it("has fail=0 on every decidable law for spec/kernel.json", () => {
    expect(j.decidable.fail).toBe(0);
    expect(j.decidable.pass).toBe(20); // 19 static rows + INV-ATTACKS-RED
    for (const r of j.rows.filter((r) => r.kind === "decidable")) {
      expect(r.status).toBe("pass");
    }
  });

  it("skips exactly the temporal laws when no trace is given — skip is not credit", () => {
    for (const r of j.rows.filter((r) => r.kind === "temporal")) {
      expect(r.status).toBe("skip");
    }
    expect(j.temporal.skip).toBe(8);
    expect(j.judged).toBe(true); // judged, which is not certified (ADR-008)
  });

  it("names each Lean inhabitant with its FORCE", () => {
    const byId = new Map(j.rows.map((r) => [r.id, r]));
    expect(byId.get("INV-G1-ENUMERABLE")?.lean).toBe("Mneme.WellFormed.WellFormed");
    expect(byId.get("INV-G1-ENUMERABLE")?.force).toBe("MUST");
    expect(byId.get("INV-AUDIT-NO-EFFECT")?.lean).toBe("Mneme.Trace.AuditNotEffect");
    expect(byId.get("INV-AUDIT-NO-EFFECT")?.force).toBe("MUST NOT");
    expect(byId.get("INV-NO-GREEDY-ONLY")?.force).toBe("MUST NOT");
  });
});

describe("judge: law mirrors are live, not constant", () => {
  it("wellFormedB rejects a duplicated graph id", () => {
    const broken = structuredClone(proj);
    broken.graphs.push(structuredClone(broken.graphs[0]!));
    expect(laws.wellFormedB(broken)).toBe(false);
  });

  it("graphWF rejects an edge into a missing node and a bad version", () => {
    const g = structuredClone(proj.graphs.find((x) => x.id === "pg-s2w")!);
    expect(laws.graphWF(g)).toBe(true);
    const ghost = structuredClone(g);
    ghost.edges[0]!.to = "no-such-node";
    expect(laws.graphWF(ghost)).toBe(false);
    const unversioned = structuredClone(g);
    unversioned.version = "v1.0";
    expect(laws.graphWF(unversioned)).toBe(false);
  });

  it("frozenAreTransformsB rejects a frozen id that is a prompt node", () => {
    const broken = structuredClone(proj);
    const holdout = broken.graphs
      .find((g) => g.id === "pg-adl")!
      .nodes.find((n) => n.id === "holdout")!;
    holdout.kind = "prompt";
    expect(laws.frozenAreTransformsB(broken)).toBe(false);
    expect(laws.evalHiddenB(broken)).toBe(false);
  });

  it("partitionProposeNoInstallB rejects a data edge into reindex (shadow install)", () => {
    const broken = structuredClone(proj);
    broken.graphs.find((g) => g.id === "pg-adl")!.edges.push({
      id: "aX",
      from: "partition-propose",
      to: "reindex",
      fromPort: "spec",
      toPort: "node",
      kind: "data",
      cyclic: false,
      guard: "",
    });
    expect(laws.partitionProposeNoInstallB(broken)).toBe(false);
  });

  it("bindIntersectsTokensB rejects a core-bind that emits CapToken[]", () => {
    const broken = structuredClone(proj);
    broken.graphs
      .find((g) => g.id === "pg-twin")!
      .nodes.find((n) => n.id === "core-bind")!
      .ports.push({ name: "minted", type: "CapToken[]", dir: "out" });
    expect(laws.bindIntersectsTokensB(broken)).toBe(false);
  });

  it("portRoutableB rejects a control edge without a guard", () => {
    const broken = structuredClone(proj);
    const e = broken.graphs
      .find((g) => g.id === "pg-core")!
      .edges.find((x) => x.kind === "control")!;
    e.guard = "";
    expect(laws.portRoutableB(broken)).toBe(false);
  });

  it("auditNotGateB rejects a pg-audit node that emits a Permit", () => {
    const broken = structuredClone(proj);
    broken.graphs
      .find((g) => g.id === "pg-audit")!
      .nodes.find((n) => n.id === "report")!
      .ports.push({ name: "permit", type: "Permit", dir: "out" });
    expect(laws.auditNotGateB(broken)).toBe(false);
  });
});

describe("judge: INV-ATTACKS-RED (five predicates, not the bundled theorem — SPEC ISSUE #1)", () => {
  it("keeps all five attack traces red", () => {
    const attacks = runAttacks();
    expect(attacks).toHaveLength(5);
    for (const a of attacks) expect(a.result).toBe(false);
    expect(attacks.map((a) => a.name)).toEqual([
      "silent-install",
      "ack-replay",
      "amortized-permit",
      "ghost-edge",
      "audit-does-not-consume",
    ]);
  });

  it("mirror sanity: the lawful counterparts pass, so red is discrimination, not a constant", () => {
    const lawfulInstall: TraceEvent[] = [
      { type: "steward.ack", id: "demo-soma" },
      { type: "twin.install", id: "demo-soma" },
    ];
    expect(installRequiresAck(lawfulInstall)).toBe(true);
    expect(twinIdRequiresInstall([
      ...lawfulInstall,
      { type: "store.read", store: "episodic", twin: "demo-soma", keys: [] },
    ])).toBe(true);
    expect(twinIdRequiresInstall([
      { type: "store.read", store: "episodic", twin: "demo-soma", keys: [] },
    ])).toBe(false);
    expect(proposeNotInstall([{ type: "partition.propose" }])).toBe(true);
    expect(proposeNotInstall([
      { type: "partition.propose" },
      { type: "twin.install", id: "x" },
    ])).toBe(false);
  });
});

describe("judge: tray fixture trace (item is slice-local, never a RuntimeCertificate)", () => {
  const storeFile = join(mkdtempSync(join(tmpdir(), "judge-tray-")), "tray.json");
  const report = runTray(FIXTURES, storeFile, kernel);
  const j = judge(kernel, report.trace.events);
  const byId = new Map(j.rows.map((r) => [r.id, r]));

  it("passes the safety laws: CommitAfterPermit, AuditNotEffect, ScheduleNonempty", () => {
    expect(byId.get("INV-COMMIT-TRACED")?.status).toBe("pass");
    expect(byId.get("INV-AUDIT-NO-EFFECT")?.status).toBe("pass");
    expect(byId.get("INV-G3-TRACE")?.status).toBe("pass");
    expect(byId.get("INV-CORE-INTERRUPT")?.status).toBe("pass");
    expect(byId.get("INV-TWIN-ID-REQUIRES-INSTALL")?.status).toBe("pass");
    expect(byId.get("INV-INSTALL-REQUIRES-ACK")?.status).toBe("pass");
    expect(j.traceSafetyFails).toEqual([]);
  });

  it("HasClusterCut and HasArchiveSample are fail — never pass — on this trace", () => {
    expect(byId.get("INV-CROSS-PARTITION-SAMPLE")?.status).toBe("fail");
    expect(byId.get("INV-NO-GREEDY-ONLY")?.status).toBe("fail");
    expect(hasClusterCut(report.trace.events)).toBe(false);
    expect(hasArchiveSample(report.trace.events)).toBe(false);
    // The trace contains no hand-added cluster.cut / archive.sample events.
    expect(report.trace.events.some((e) => e.type === "cluster.cut")).toBe(false);
    expect(report.trace.events.some((e) => e.type === "archive.sample")).toBe(false);
  });

  it("supplementary Temporal conjuncts hold on the fixture trace", () => {
    for (const s of supplementaryTemporal(kernel, report.trace.events)) {
      expect(s.status).toBe("pass");
    }
  });
});

describe("runtime certificate attempt (SPEC ISSUE #2)", () => {
  it("fails closed on the undeclared tau guard — BLOCKED-RUNTIME", () => {
    const attempt = attemptRuntimeRun(kernel);
    expect(attempt.blocked).toBe(true);
    expect(attempt.error).toContain("score < tau");
    // The scheduler legitimately reached holdout through declared edges…
    expect(attempt.entered).toEqual([
      "sample",
      "cluster",
      "cut-class",
      "propose-abs",
      "holdout",
    ]);
  });
});

describe("lean export parity", () => {
  it("regenerating proofs/KernelIR.lean is byte-identical to the committed file", () => {
    const committed = readFileSync(KERNEL_IR_LEAN_PATH, "utf8");
    expect(renderKernelIR(proj)).toBe(committed);
  });

  it("the projection carries structure only — no prompt bodies, hashes, or signatures", () => {
    const rendered = renderKernelIR(proj);
    expect(rendered).not.toContain("bodyHash :=");
    expect(rendered).not.toContain("signature :=");
    expect(rendered).not.toContain("promptRef :=");
    expect(rendered).not.toContain("fnv1a:");
    expect(rendered).not.toContain("prompts/");
    expect(rendered).not.toContain("by native_decide");
    expect(rendered).toContain("theorem kernel_laws : Laws kernel");
    expect(rendered).toContain("#guard_msgs in #print axioms kernel_laws");
  });
});
