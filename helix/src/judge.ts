/**
 * The untrusted judge (ADR-008): a TypeScript fold of every inhabitant
 * in spec/inhabitants.md over the kernel IR, plus the ADR-014 attack
 * traces, plus an optional mneme.trace/v1 file for the temporal laws.
 *
 *   bun src/judge.ts                 # kernel fold + attack traces
 *   bun src/judge.ts --trace f.json  # also judge a trace file
 *   bun src/judge.ts --runtime       # attempt the RuntimeCertificate run
 *
 * Passing this judge is not a proof. The Lean artifacts are:
 * proofs/KernelIR.lean (static Certificate, by decide) and
 * proofs/Regressions.lean (attacks red). skip is incomplete, never 100%;
 * "judge fail=0" alone is never done (brief §13).
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadKernel, type KernelIR } from "./kernel.js";
import { projectKernel, type LeanKernel } from "./lean-kernel.js";
import * as laws from "./laws.js";
import {
  auditNotEffect,
  commitAfterPermit,
  denyImpliesInterrupt,
  hasArchiveSample,
  hasClusterCut,
  installRequiresAck,
  proposeNotInstall,
  scheduleNonempty,
  twinIdRequiresInstall,
  validTrace,
  type TraceEvent,
  type TraceFile,
} from "./trace.js";
import { makeEmitter, runGraph, type Appliers } from "./scheduler.js";

export type Force = "MUST" | "MUST NOT";
export type Status = "pass" | "fail" | "skip";

export interface Row {
  id: string;
  lean: string;
  force: Force;
  kind: "decidable" | "temporal";
  /** Liveness laws may fail on a partial trace without unjudging the
   *  kernel; they gate RuntimeCertificate, which judge cannot grant. */
  liveness?: boolean;
  status: Status;
  note?: string;
}

interface Invariant {
  id: string;
  lean: string;
  force: Force;
  check?: (k: LeanKernel) => boolean;
  temporal?: (events: TraceEvent[]) => boolean;
  liveness?: boolean;
}

/** Every inhabitant of spec/inhabitants.md except INV-ATTACKS-RED, which
 *  is judged separately over the ADR-014 negative traces. FORCE is the
 *  brief's §3 MUST / §4 MUST NOT split. */
const INVARIANTS: Invariant[] = [
  { id: "INV-G1-ENUMERABLE", lean: "Mneme.WellFormed.WellFormed", force: "MUST", check: laws.wellFormedB },
  { id: "INV-PORT-ROUTABLE", lean: "Mneme.Laws.PortRoutable", force: "MUST", check: laws.portRoutableB },
  { id: "INV-G4-VERSIONED", lean: "Mneme.WellFormed.graphWF", force: "MUST", check: (k) => k.graphs.every(laws.graphWF) },
  { id: "INV-G2-KIND-SPLIT", lean: "Mneme.Laws.FrozenTransforms", force: "MUST", check: laws.frozenAreTransformsB },
  { id: "INV-G3-TRACE", lean: "Mneme.Trace.ScheduleNonempty", force: "MUST", temporal: scheduleNonempty },
  { id: "INV-LAYERS-FOUR", lean: "Mneme.WellFormed.layersFour", force: "MUST", check: laws.layersFour },
  { id: "INV-STRUCTURAL-NO-MODEL", lean: "Mneme.Laws.StructuralIsTransform", force: "MUST", check: laws.structuralIsTransformB },
  { id: "INV-HYBRID-DECLARED", lean: "Mneme.Laws.HybridDeclared", force: "MUST", check: laws.hybridDeclaredB },
  { id: "INV-COMMIT-TRACED", lean: "Mneme.Trace.CommitAfterPermit", force: "MUST", temporal: commitAfterPermit },
  { id: "INV-CORE-NOT-DARWINIAN", lean: "Mneme.Laws.AuthorNotCore", force: "MUST NOT", check: laws.authorNotCoreB },
  { id: "INV-TWINS-NEVER-WRITE-CORE", lean: "Mneme.Laws.HasSelfAndAuth", force: "MUST NOT", check: laws.hasSelfAndAuthB },
  { id: "INV-CAP-TOKENS", lean: "Mneme.Laws.CapTokenPort", force: "MUST", check: laws.capTokenPortB },
  { id: "INV-BIND-INTERSECT", lean: "Mneme.Laws.BindIntersectsTokens", force: "MUST", check: laws.bindIntersectsTokensB },
  { id: "INV-CORE-INTERRUPT", lean: "Mneme.Trace.DenyImpliesInterrupt", force: "MUST", temporal: denyImpliesInterrupt },
  { id: "INV-SEEDS-NOT-ONTOLOGY", lean: "Mneme.Laws.TwinOrigin", force: "MUST", check: laws.twinOriginB },
  { id: "INV-ACTION-GATE", lean: "Mneme.Laws.HasActionGate", force: "MUST", check: laws.hasActionGateB },
  { id: "INV-PARTITION-NOT-INSTALL", lean: "Mneme.Laws.PartitionProposeNoInstall", force: "MUST NOT", check: laws.partitionProposeNoInstallB },
  { id: "INV-REINDEX-NO-SPEC", lean: "Mneme.Laws.ReindexNoSpec", force: "MUST NOT", check: laws.reindexNoSpecB },
  { id: "INV-CROSS-PARTITION-SAMPLE", lean: "Mneme.Trace.HasClusterCut", force: "MUST", temporal: hasClusterCut, liveness: true },
  { id: "INV-TWIN-ID-REQUIRES-INSTALL", lean: "Mneme.Trace.TwinIdRequiresInstall", force: "MUST", temporal: twinIdRequiresInstall },
  { id: "INV-INSTALL-REQUIRES-ACK", lean: "Mneme.Trace.InstallRequiresAck", force: "MUST", temporal: installRequiresAck },
  { id: "INV-AUDIT-NOT-GATE", lean: "Mneme.Laws.AuditNotGate", force: "MUST NOT", check: laws.auditNotGateB },
  { id: "INV-AUDIT-NO-EFFECT", lean: "Mneme.Trace.AuditNotEffect", force: "MUST NOT", temporal: auditNotEffect },
  { id: "INV-ARCHIVE-KEEPS-LOSERS", lean: "Mneme.Laws.ArchiveKeepsLosers", force: "MUST", check: laws.archiveKeepsLosersB },
  { id: "INV-EVAL-HIDDEN", lean: "Mneme.Laws.EvalHidden", force: "MUST", check: laws.evalHiddenB },
  { id: "INV-CUT-CLASSIFY", lean: "Mneme.Laws.CutClassify", force: "MUST", check: laws.cutClassifyB },
  { id: "INV-NO-GREEDY-ONLY", lean: "Mneme.Trace.HasArchiveSample", force: "MUST NOT", temporal: hasArchiveSample, liveness: true },
];

/** The ADR-014 negative traces, byte-parity with spec/lean/Negatives.lean.
 *  Judged predicate-by-predicate: the bundled `attacksRed` theorem does not
 *  compile as shipped (SPEC ISSUE #1), so the five individual laws are the
 *  target, exactly as proofs/Regressions.lean proves them. */
export interface Attack {
  name: string;
  predicate: string;
  /** false = the attack stays red. true is a regression, never progress. */
  result: boolean;
}

/** Mirrors `Mneme.emptyKernel` in Negatives.lean (only `graphs` matters
 *  to `mentionsExist`; the rest is carried for shape fidelity). */
const EMPTY_KERNEL: KernelIR = {
  spec: "mneme.spec/0.9",
  layers: [],
  graphs: [],
  twins: [],
  frozen: [],
  auditPolicy: { sampleRate: 0, sampleFloor: 0, spike: 0 },
};

export function runAttacks(): Attack[] {
  const silentInstall: TraceEvent[] = [{ type: "twin.install", id: "demo-soma" }];
  const ackReplay: TraceEvent[] = [
    { type: "steward.ack", id: "demo-soma" },
    { type: "twin.install", id: "demo-soma" },
    { type: "twin.install", id: "demo-soma" },
  ];
  const amortizedPermit: TraceEvent[] = [
    { type: "core.permit" },
    { type: "store.write", store: "ltm", keys: [] },
    { type: "store.write", store: "lineage", keys: [] },
  ];
  const ghostEdge: TraceEvent[] = [{ type: "edge.fire", edge: "zz9", kind: "data" }];
  const auditDoesNotConsume: TraceEvent[] = [
    { type: "store.write", store: "audit.inbox", keys: [] },
    { type: "store.write", store: "ltm", keys: [] },
  ];
  return [
    { name: "silent-install", predicate: "installRequiresAckB", result: installRequiresAck(silentInstall) },
    { name: "ack-replay", predicate: "installRequiresAckB", result: installRequiresAck(ackReplay) },
    { name: "amortized-permit", predicate: "commitAfterPermitB", result: commitAfterPermit(amortizedPermit) },
    { name: "ghost-edge", predicate: "mentionsExist (emptyKernel)", result: validTrace(EMPTY_KERNEL, ghostEdge) },
    { name: "audit-does-not-consume", predicate: "commitAfterPermitB", result: commitAfterPermit(auditDoesNotConsume) },
  ];
}

export interface Judgement {
  rows: Row[];
  attacks: Attack[];
  attacksAllRed: boolean;
  decidable: { pass: number; fail: number };
  temporal: { pass: number; fail: number; skip: number };
  /** Temporal safety fails on a provided trace (liveness excluded). */
  traceSafetyFails: string[];
  judged: boolean;
}

export function judge(kernel: KernelIR, events?: TraceEvent[]): Judgement {
  const proj = projectKernel(kernel);
  const rows: Row[] = INVARIANTS.map((inv) => {
    if (inv.check) {
      return {
        id: inv.id,
        lean: inv.lean,
        force: inv.force,
        kind: "decidable",
        status: inv.check(proj) ? "pass" : "fail",
      };
    }
    if (events === undefined) {
      return {
        id: inv.id,
        lean: inv.lean,
        force: inv.force,
        kind: "temporal",
        ...(inv.liveness ? { liveness: true } : {}),
        status: "skip",
        note: "no trace",
      };
    }
    const ok = inv.temporal!(events);
    return {
      id: inv.id,
      lean: inv.lean,
      force: inv.force,
      kind: "temporal",
      ...(inv.liveness ? { liveness: true } : {}),
      status: ok ? "pass" : "fail",
      ...(!ok && inv.liveness
        ? { note: "liveness — blocks RuntimeCertificate only" }
        : {}),
    };
  });

  const attacks = runAttacks();
  const attacksAllRed = attacks.every((a) => !a.result);
  const decidable = {
    pass: rows.filter((r) => r.kind === "decidable" && r.status === "pass").length +
      (attacksAllRed ? 1 : 0),
    fail: rows.filter((r) => r.kind === "decidable" && r.status === "fail").length +
      (attacksAllRed ? 0 : 1),
  };
  const temporal = {
    pass: rows.filter((r) => r.kind === "temporal" && r.status === "pass").length,
    fail: rows.filter((r) => r.kind === "temporal" && r.status === "fail").length,
    skip: rows.filter((r) => r.kind === "temporal" && r.status === "skip").length,
  };
  const traceSafetyFails = rows
    .filter((r) => r.kind === "temporal" && r.status === "fail" && !r.liveness)
    .map((r) => r.id);
  return {
    rows,
    attacks,
    attacksAllRed,
    decidable,
    temporal,
    traceSafetyFails,
    judged: decidable.fail === 0 && traceSafetyFails.length === 0,
  };
}

/** Supplementary temporal conjuncts of Mneme.Trace.Temporal that carry no
 *  INV id in inhabitants.md but still gate RuntimeCertificate. */
export function supplementaryTemporal(
  kernel: KernelIR,
  events: TraceEvent[],
): { lean: string; status: Status }[] {
  return [
    { lean: "Mneme.Trace.ValidTrace", status: validTrace(kernel, events) ? "pass" : "fail" },
    { lean: "Mneme.Trace.ProposeNotInstall", status: proposeNotInstall(events) ? "pass" : "fail" },
  ];
}

export interface RuntimeAttempt {
  blocked: boolean;
  entered: string[];
  error?: string;
}

/**
 * Attempt the run a RuntimeCertificate needs: pg-adl owns cluster.cut,
 * and its ordinary path (cut-class → propose-abs → holdout, ADR-004:
 * partition is the rare cut) must evaluate the a6/a7 guards
 * `score < tau` / `score >= tau`. No IR surface declares tau (pg-adl
 * ingress is ltm, fuel only), so a pure scheduler fails closed — that is
 * SPEC ISSUE #2. The appliers below are routing stand-ins that emit no
 * effect events: this is a schedulability probe, never a trace to
 * certify. Inventing tau, patching spec/, or emitting cluster.cut from a
 * stub would be a stuffed log, not a certificate.
 */
export function attemptRuntimeRun(kernel: KernelIR): RuntimeAttempt {
  const emitter = makeEmitter();
  const appliers: Appliers = {
    "pg-adl/sample": () => ({ batch: { items: ["b1"] } }),
    "pg-adl/cluster": () => ({ groups: [{ id: "c1" }, { id: "c2" }] }),
    // The ordinary cut: most communities become abstractions (brief §7).
    "pg-adl/cut-class": (inputs) => ({
      kind: "abstraction",
      groups_out: inputs.groups,
    }),
    "pg-adl/propose-abs": (inputs) => ({
      abs: { name: "abs-1", from: inputs.groups },
    }),
    "pg-adl/holdout": (inputs) => ({ score: 0.5, abs_out: inputs.abs }),
    "pg-adl/compile-node": (inputs) => ({ node: { abs: inputs.abs } }),
    "pg-adl/reindex": () => ({ ltm: {} }),
    "pg-adl/partition-propose": () => ({ spec: null }),
    "pg-adl/lineage-record": (inputs) => ({ ack: { spec: inputs.spec } }),
  };
  try {
    runGraph(kernel, "pg-adl", { ltm: { batches: 1 }, fuel: {} }, appliers, emitter);
  } catch (err) {
    return {
      blocked: true,
      entered: emitter.events
        .filter((e) => e.type === "node.enter")
        .map((e) => (e.type === "node.enter" ? e.node : "")),
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    blocked: false,
    entered: emitter.events
      .filter((e) => e.type === "node.enter")
      .map((e) => (e.type === "node.enter" ? e.node : "")),
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printJudgement(j: Judgement, traceLabel?: string): void {
  console.log("judge: untrusted TypeScript fold over spec/inhabitants.md (ADR-008)");
  console.log("kernel: spec/kernel.json (mneme.spec/0.10)");
  if (traceLabel) console.log(`trace: ${traceLabel}`);
  console.log("");
  for (const r of j.rows) {
    const status = r.status + (r.note ? ` (${r.note})` : "");
    console.log(
      `  ${pad(r.id, 30)} ${pad(r.lean, 40)} ${pad(r.force, 9)} ${status}`,
    );
  }
  console.log("");
  console.log("  INV-ATTACKS-RED — five ADR-014 attack traces; each predicate must stay false.");
  console.log("  (Judged predicate-by-predicate: the pack's bundled attacksRed theorem does");
  console.log("  not compile — SPEC ISSUE #1 — so the five laws are the target, as in");
  console.log("  proofs/Regressions.lean.)");
  for (const a of j.attacks) {
    const verdict = a.result ? "GREEN — REGRESSION" : "red (correct)";
    console.log(`    ${pad(a.name, 24)} ${pad(a.predicate, 26)} = ${a.result} → ${verdict}`);
  }
  console.log(
    `  ${pad("INV-ATTACKS-RED", 30)} ${pad("Mneme.Negatives.attacksRed", 40)} ${pad("MUST", 9)} ${j.attacksAllRed ? "pass" : "fail"}`,
  );
  console.log("");
  console.log(
    `judge: decidable pass=${j.decidable.pass} fail=${j.decidable.fail} | temporal pass=${j.temporal.pass} fail=${j.temporal.fail} skip=${j.temporal.skip}`,
  );
  console.log(
    "skip is not credit; judged is not certified. The Lean terms in proofs/ are the artifacts (ADR-008).",
  );
}

export function main(argv: string[]): number {
  let tracePath: string | null = null;
  let runtime = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--trace") {
      const v = argv[++i];
      if (v === undefined) throw new Error("missing value for --trace");
      tracePath = resolve(v);
    } else if (a === "--runtime") {
      runtime = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }

  const kernel = loadKernel();

  if (runtime) {
    console.log("runtime-certificate attempt: running pg-adl (the graph that owns cluster.cut)");
    console.log("through its declared abstraction path with routing stand-ins…");
    const attempt = attemptRuntimeRun(kernel);
    console.log(`  nodes entered (declared edges only): ${attempt.entered.join(" → ")}`);
    if (attempt.blocked) {
      console.log(`  scheduler failed closed: ${attempt.error}`);
      console.log("");
      console.log("BLOCKED-RUNTIME: SPEC ISSUE #2 — pg-adl guards a6 (`score < tau`) and a7");
      console.log("(`score >= tau`) reference `tau`, which no IR surface declares (pg-adl");
      console.log("ingress is `ltm`, `fuel` only). A pure scheduler cannot evaluate these");
      console.log("guards without inventing a threshold, so Helix fails closed and pg-adl is");
      console.log("not schedulable from the IR alone. No cluster.cut/archive.sample events");
      console.log("will be stubbed to fake Temporal; there is no RuntimeCertificate until the");
      console.log("steward ships the 0.11 fix (declare tau in pg-adl ingress, or fold it into");
      console.log("holdout's frozen configuration).");
      return 0;
    }
    console.log("  UNEXPECTED: the tau guards evaluated. Someone declared or invented tau —");
    console.log("  that is a spec change, not progress. Stop and ask the steward.");
    return 1;
  }

  let events: TraceEvent[] | undefined;
  let label: string | undefined;
  if (tracePath) {
    const file = JSON.parse(readFileSync(tracePath, "utf8")) as TraceFile;
    if (file.trace !== "mneme.trace/v1") {
      throw new Error(`not a mneme.trace/v1 file: ${tracePath}`);
    }
    events = file.events;
    label = `${tracePath} (${events.length} events)`;
  }

  const j = judge(kernel, events);
  printJudgement(j, label);
  if (events !== undefined) {
    console.log("");
    console.log("  temporal conjuncts of Mneme.Trace.Temporal without an INV id:");
    for (const s of supplementaryTemporal(kernel, events)) {
      console.log(`    ${pad(s.lean, 40)} ${s.status}`);
      if (s.status === "fail") j.traceSafetyFails.push(s.lean);
    }
    const liveGaps = j.rows.filter((r) => r.liveness && r.status !== "pass");
    if (liveGaps.length > 0) {
      console.log("");
      console.log(
        `  this trace is not a RuntimeCertificate candidate: ${liveGaps.map((r) => r.lean).join(", ")} unsatisfied (see --runtime for why).`,
      );
    }
  }
  return j.judged && j.traceSafetyFails.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`judge: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
