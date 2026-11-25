/**
 * Differential testing, generation half: seeded cases and their renderings.
 *
 * The Lean pack is the certificate of record; the Bend layer (bend/) and the
 * TypeScript mirrors (laws.ts, trace.ts) are re-implementations of its
 * decidable predicates. This module builds a deterministic corpus of inputs
 * (kernels mutated from the real one, and event traces) and renders each as
 * a Lean file and a Bend file. differential.ts runs the three
 * implementations on the same inputs and compares what they say.
 *
 * Nothing here is a certificate. Agreement on a finite corpus is evidence
 * that two implementations match, never a proof that they do.
 */
import type { KernelIR } from "./kernel.js";
import { projectKernel, type LeanEdge, type LeanGraph, type LeanKernel, type LeanNode } from "./lean-kernel.js";
import * as laws from "./laws.js";
import * as trace from "./trace.js";
import type { TraceEvent } from "./trace.js";
import { edge as bendEdge, node as bendNode, str as bendStr, strList as bendStrList } from "./bend-export.js";

// ---------------------------------------------------------------------------
// Predicates: one table drives generation checks, rendering, and comparison.

export interface KernelPredicate {
  name: string;
  lean: string; // Lean fn applied to the kernel `k`
  bend: string; // Bend fn applied to the kernel `k`
  ts: (k: LeanKernel) => boolean;
}

export const KERNEL_PREDICATES: KernelPredicate[] = [
  { name: "wellFormed", lean: "wellFormedB", bend: "W.wellFormed", ts: laws.wellFormedB },
  { name: "frozenTransforms", lean: "frozenAreTransformsB", bend: "D.frozenTransforms", ts: laws.frozenAreTransformsB },
  { name: "structuralIsTransform", lean: "structuralIsTransformB", bend: "D.structuralIsTransform", ts: laws.structuralIsTransformB },
  { name: "hybridDeclared", lean: "hybridDeclaredB", bend: "D.hybridDeclared", ts: laws.hybridDeclaredB },
  { name: "authorNotCore", lean: "authorNotCoreB", bend: "D.authorNotCore", ts: laws.authorNotCoreB },
  { name: "hasSelfAndAuth", lean: "hasSelfAndAuthB", bend: "D.hasSelfAndAuth", ts: laws.hasSelfAndAuthB },
  { name: "capTokenPort", lean: "capTokenPortB", bend: "D.capTokenPort", ts: laws.capTokenPortB },
  { name: "twinOrigin", lean: "twinOriginB", bend: "D.twinOrigin", ts: laws.twinOriginB },
  { name: "hasActionGate", lean: "hasActionGateB", bend: "D.hasActionGate", ts: laws.hasActionGateB },
  { name: "partitionProposeNoInstall", lean: "partitionProposeNoInstallB", bend: "D.partitionProposeNoInstall", ts: laws.partitionProposeNoInstallB },
  { name: "reindexNoSpec", lean: "reindexNoSpecB", bend: "D.reindexNoSpec", ts: laws.reindexNoSpecB },
  { name: "bindIntersectsTokens", lean: "bindIntersectsTokensB", bend: "D.bindIntersectsTokens", ts: laws.bindIntersectsTokensB },
  { name: "archiveKeepsLosers", lean: "archiveKeepsLosersB", bend: "D.archiveKeepsLosers", ts: laws.archiveKeepsLosersB },
  { name: "evalHidden", lean: "evalHiddenB", bend: "D.evalHidden", ts: laws.evalHiddenB },
  { name: "cutClassify", lean: "cutClassifyB", bend: "D.cutClassify", ts: laws.cutClassifyB },
  { name: "portRoutable", lean: "portRoutableB", bend: "D.portRoutable", ts: laws.portRoutableB },
  { name: "auditNotGate", lean: "auditNotGateB", bend: "D.auditNotGate", ts: laws.auditNotGateB },
];

/** The conjunction of all seventeen (Lean `Laws`, Bend `D.laws`). */
export const LAWS_PREDICATE = "laws";

export interface TracePredicate {
  name: string;
  lean: string; // Lean expression over the trace `t` (and `baseKernel`)
  bend: string; // Bend expression over the trace `t` (and `baseKernel()`)
  ts: (events: TraceEvent[], base: KernelIR) => boolean;
}

export const TRACE_PREDICATES: TracePredicate[] = [
  { name: "validTrace", lean: "validTraceB baseKernel t", bend: "T.validTrace(baseKernel(), t)", ts: (e, b) => trace.validTrace(b, e) },
  { name: "denyImpliesInterrupt", lean: "denyImpliesInterruptB t", bend: "T.denyImpliesInterrupt(t)", ts: (e) => trace.denyImpliesInterrupt(e) },
  { name: "commitAfterPermit", lean: "commitAfterPermitB t", bend: "T.commitAfterPermit(t)", ts: (e) => trace.commitAfterPermit(e) },
  { name: "proposeNotInstall", lean: "proposeNotInstallB t", bend: "T.proposeNotInstall(t)", ts: (e) => trace.proposeNotInstall(e) },
  { name: "twinIdRequiresInstall", lean: "twinIdRequiresInstallB t", bend: "T.twinIdRequiresInstall(t)", ts: (e) => trace.twinIdRequiresInstall(e) },
  { name: "installRequiresAck", lean: "installRequiresAckB t", bend: "T.installRequiresAck(t)", ts: (e) => trace.installRequiresAck(e) },
  { name: "hasClusterCut", lean: "hasClusterCutB t", bend: "T.hasClusterCut(t)", ts: (e) => trace.hasClusterCut(e) },
  { name: "hasArchiveSample", lean: "hasArchiveSampleB t", bend: "T.hasArchiveSample(t)", ts: (e) => trace.hasArchiveSample(e) },
  { name: "scheduleNonempty", lean: "scheduleNonemptyB t", bend: "T.scheduleNonempty(t)", ts: (e) => trace.scheduleNonempty(e) },
  { name: "auditNotEffect", lean: "auditNotEffectB t", bend: "T.auditNotEffect(t)", ts: (e) => trace.auditNotEffect(e) },
];

// ---------------------------------------------------------------------------
// Seeded randomness.

export type Rng = () => number;

/** mulberry32: small, fast, and identical on every platform. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rng, n: number): number => Math.floor(r() * n);
const chance = (r: Rng, p: number): boolean => r() < p;
function pick<T>(r: Rng, xs: readonly T[]): T {
  if (xs.length === 0) throw new Error("pick from empty list");
  return xs[int(r, xs.length)]!;
}
function weighted<T>(r: Rng, xs: readonly [T, number][]): T {
  const total = xs.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [v, w] of xs) {
    x -= w;
    if (x < 0) return v;
  }
  return xs[xs.length - 1]![0];
}

// ---------------------------------------------------------------------------
// Traces.

export interface TraceCase {
  id: string;
  events: TraceEvent[];
}

const IDS = ["a", "b", "c"] as const;
const STORES = ["ltm", "audit.inbox", "lineage", "scratch"] as const;

function randomEvent(r: Rng, k: KernelIR): TraceEvent {
  const type = weighted<TraceEvent["type"]>(r, [
    ["core.permit", 10],
    ["core.deny", 6],
    ["core.interrupt", 5],
    ["store.write", 12],
    ["store.read", 6],
    ["twin.install", 8],
    ["steward.ack", 8],
    ["partition.propose", 4],
    ["node.enter", 8],
    ["node.exit", 3],
    ["edge.fire", 4],
    ["prompt.audit", 5],
    ["twin.action", 3],
    ["archive.commit", 2],
    ["archive.sample", 3],
    ["cluster.cut", 3],
    ["cut.classify", 1],
    ["cap.mint", 1],
    ["cap.revoke", 1],
  ]);
  const twin = (): string | undefined => (chance(r, 0.5) ? undefined : pick(r, IDS));
  switch (type) {
    case "node.enter":
    case "node.exit": {
      const g = pick(r, k.graphs);
      const real = chance(r, 0.75);
      const graph = real ? g.id : pick(r, ["pg-zz", "pg-audit", "pg-w2l"]);
      const node = real && chance(r, 0.9) ? pick(r, g.nodes).id : pick(r, ["zz", "commit", "audit-heuristics"]);
      return type === "node.enter"
        ? { type, graph, node, t: 0 }
        : { type, graph, node, ports: [] };
    }
    case "edge.fire": {
      const all = k.graphs.flatMap((g) => g.edges.map((e) => e.id));
      return { type, edge: chance(r, 0.7) ? pick(r, all) : "zz9", kind: "data" };
    }
    case "store.read":
    case "store.write": {
      const t = twin();
      return t === undefined
        ? { type, store: pick(r, STORES), keys: [] }
        : { type, store: pick(r, STORES), twin: t, keys: [] };
    }
    case "twin.install":
    case "steward.ack":
      return { type, id: pick(r, IDS) };
    default:
      return { type } as TraceEvent;
  }
}

/** Short event runs the laws care about, so random traces hit their branches. */
function motif(r: Rng): TraceEvent[] {
  const id = pick(r, IDS);
  return pick(r, [
    () => [{ type: "steward.ack", id }, { type: "twin.install", id }] as TraceEvent[],
    () => [{ type: "twin.install", id }] as TraceEvent[],
    () => [{ type: "core.permit" }, { type: "store.write", store: pick(r, STORES), keys: [] }] as TraceEvent[],
    () => [{ type: "core.deny" }, { type: "core.interrupt" }] as TraceEvent[],
    () => [{ type: "core.deny" }] as TraceEvent[],
    () => [{ type: "prompt.audit" }, { type: "store.write", store: pick(r, STORES), keys: [] }] as TraceEvent[],
    () => [{ type: "partition.propose" }, { type: "twin.install", id }] as TraceEvent[],
    () => [{ type: "core.permit" }, { type: "core.deny" }, { type: "store.write", store: "ltm", keys: [] }] as TraceEvent[],
    () => [{ type: "twin.install", id }, { type: "store.write", store: "ltm", twin: id, keys: [] }] as TraceEvent[],
    () => [{ type: "node.enter", graph: "pg-audit", node: "collect", t: 0 }, { type: "core.permit" }] as TraceEvent[],
    // After an audit, leaving the audit graph cools the trace; staying in it does not.
    () => [{ type: "prompt.audit" }, { type: "node.enter", graph: "pg-w2l", node: "commit", t: 0 }, { type: "core.permit" }] as TraceEvent[],
    () => [{ type: "prompt.audit" }, { type: "node.enter", graph: "pg-audit", node: "collect", t: 0 }, { type: "store.write", store: "ltm", keys: [] }] as TraceEvent[],
  ])();
}

/** Fixed traces: the five ADR-014 attacks and a few greens, always included. */
export function fixedTraces(): TraceCase[] {
  const w = (store: string, twin?: string): TraceEvent =>
    twin === undefined ? { type: "store.write", store, keys: [] } : { type: "store.write", store, twin, keys: [] };
  return [
    { id: "t_empty", events: [] },
    { id: "t_silent_install", events: [{ type: "twin.install", id: "demo-soma" }] },
    {
      id: "t_ack_replay",
      events: [
        { type: "steward.ack", id: "demo-soma" },
        { type: "twin.install", id: "demo-soma" },
        { type: "twin.install", id: "demo-soma" },
      ],
    },
    { id: "t_amortized_permit", events: [{ type: "core.permit" }, w("ltm"), w("lineage")] },
    { id: "t_ghost_edge", events: [{ type: "edge.fire", edge: "zz9", kind: "data" }] },
    { id: "t_audit_does_not_consume", events: [w("audit.inbox"), w("ltm")] },
    {
      id: "t_acked_install",
      events: [{ type: "steward.ack", id: "demo-soma" }, { type: "twin.install", id: "demo-soma" }],
    },
    { id: "t_permit_write", events: [{ type: "core.permit" }, w("ltm")] },
    { id: "t_inbox_only", events: [w("audit.inbox")] },
    { id: "t_deny_interrupt", events: [{ type: "core.deny" }, { type: "core.interrupt" }] },
  ];
}

export function genTraces(r: Rng, base: KernelIR, n: number): TraceCase[] {
  const out = fixedTraces();
  for (let i = 0; i < n; i++) {
    const events: TraceEvent[] = [];
    if (chance(r, 0.6)) {
      for (let m = 1 + int(r, 3); m > 0; m--) events.push(...motif(r));
    }
    const noise = int(r, 6);
    for (let j = 0; j < noise; j++) {
      events.splice(int(r, events.length + 1), 0, randomEvent(r, base));
    }
    out.push({ id: `t${i}`, events });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kernels.

export interface KernelCase {
  id: string;
  kernel: LeanKernel;
  /** What was done to the real kernel, for the report. */
  how: string[];
}

const PORT_TYPES = [
  "IdentitySnapshot",
  "InclusionReport",
  "TwinSpec",
  "DomainAck",
  "CapToken",
  "CapToken[]",
  "LineageArchive",
  "Permit",
  "ExternalEffect",
  "TwinId",
  "CoreStore",
  "LTM",
  "Gap[]",
] as const;

/** The (graph, node) pairs the laws look at; mutations aim here half the time. */
const RELEVANT: [string, string][] = [
  ["pg-w2l", "structural"], ["pg-w2l", "semantic"], ["pg-w2l", "skill"], ["pg-w2l", "hybrid"],
  ["pg-w2l", "align"], ["pg-w2l", "commit"],
  ["pg-dem", "author"], ["pg-dem", "validate"], ["pg-dem", "register"], ["pg-dem", "archive"],
  ["pg-core", "self-upd"], ["pg-core", "twin-auth"],
  ["pg-twin", "action-gate"], ["pg-twin", "core-bind"],
  ["pg-adl", "partition-propose"], ["pg-adl", "lineage-record"], ["pg-adl", "reindex"],
  ["pg-adl", "holdout"], ["pg-adl", "cut-class"], ["pg-adl", "cluster"],
  ["pg-audit", "audit-heuristics"], ["pg-audit", "sample-clean"],
];

const VERSIONS = ["", "mneme.graph", "mneme.graph/", "mneme.graph/x", "v1", "Mneme.graph/1", "xmneme.graph/1"] as const;

type Focus = readonly [string, string][];

function target(r: Rng, k: LeanKernel, focus: Focus = RELEVANT, prob = 0.55): { g: LeanGraph; n: LeanNode } | undefined {
  if (chance(r, prob)) {
    const [gid, nid] = pick(r, focus);
    const g = k.graphs.find((x) => x.id === gid);
    const n = g?.nodes.find((x) => x.id === nid);
    if (g && n) return { g, n };
  }
  const gs = k.graphs.filter((g) => g.nodes.length > 0);
  if (gs.length === 0) return undefined;
  const g = pick(r, gs);
  return { g, n: pick(r, g.nodes) };
}

type Mutation = (r: Rng, k: LeanKernel, focus: Focus, prob: number) => string | undefined;

const MUTATIONS: [Mutation, number][] = [
  [(r, k, focus, prob) => {
    const t = target(r, k, focus, prob); if (!t) return;
    t.g.nodes.splice(t.g.nodes.indexOf(t.n), 1);
    return `drop node ${t.g.id}/${t.n.id}`;
  }, 6],
  [(r, k, focus, prob) => {
    const t = target(r, k, focus, prob); if (!t) return;
    t.n.kind = t.n.kind === "prompt" ? "transform" : "prompt";
    return `flip kind ${t.g.id}/${t.n.id}`;
  }, 6],
  [(r, k, focus, prob) => {
    const t = target(r, k, focus, prob); if (!t) return;
    const ty = pick(r, PORT_TYPES);
    const dir = chance(r, 0.5) ? "out" : "in";
    t.n.ports.push({ name: chance(r, 0.15) ? "install" : "x", type: ty, dir });
    return `add ${dir} port ${ty} to ${t.g.id}/${t.n.id}`;
  }, 6],
  [(r, k, focus, prob) => {
    const t = target(r, k, focus, prob); if (!t || t.n.ports.length === 0) return;
    const i = int(r, t.n.ports.length);
    const [p] = t.n.ports.splice(i, 1);
    return `drop port ${p!.type} from ${t.g.id}/${t.n.id}`;
  }, 4],
  [(r, k, focus, prob) => {
    const t = target(r, k, focus, prob); if (!t || t.n.ports.length === 0) return;
    const p = pick(r, t.n.ports);
    p.dir = p.dir === "in" ? "out" : "in";
    return `flip port dir ${p.type} on ${t.g.id}/${t.n.id}`;
  }, 4],
  [(r, k, focus, prob) => {
    const t = target(r, k, focus, prob); if (!t || t.n.ports.length === 0) return;
    const p = pick(r, t.n.ports);
    p.type = pick(r, PORT_TYPES);
    return `retype port to ${p.type} on ${t.g.id}/${t.n.id}`;
  }, 4],
  [(r, k) => {
    const gs = k.graphs.filter((g) => g.edges.length > 0); if (gs.length === 0) return;
    const g = pick(r, gs); const [e] = g.edges.splice(int(r, g.edges.length), 1);
    return `drop edge ${g.id}/${e!.id}`;
  }, 3],
  [(r, k) => {
    const gs = k.graphs.filter((g) => g.edges.length > 0); if (gs.length === 0) return;
    const g = pick(r, gs); const e = pick(r, g.edges);
    const which = pick(r, ["fromPort", "toPort", "guard"] as const);
    e[which] = "";
    if (which === "guard") e.kind = "control";
    return `blank ${which} of edge ${g.id}/${e.id}`;
  }, 5],
  [(r, k) => {
    const gs = k.graphs.filter((g) => g.edges.length > 0); if (gs.length === 0) return;
    const g = pick(r, gs); const e = pick(r, g.edges);
    e.to = pick(r, ["zz", "reindex", "lineage-record", ""]);
    return `retarget edge ${g.id}/${e.id} to ${e.to}`;
  }, 3],
  [(r, k) => {
    const g = k.graphs.find((x) => x.id === "pg-adl"); if (!g) return;
    g.edges.push(edgeOf(pick(r, ["partition-propose", "cut-class"]), pick(r, ["reindex", "lineage-record"])));
    return "add pg-adl edge toward reindex/lineage-record";
  }, 3],
  [(r, k) => {
    const g = pick(r, k.graphs); g.version = pick(r, VERSIONS);
    return `version of ${g.id} = ${JSON.stringify(g.version)}`;
  }, 4],
  [(r, k, focus, prob) => {
    const t = target(r, k, focus, prob); if (!t) return;
    t.g.nodes.push(structuredClone(t.n));
    return `duplicate node ${t.g.id}/${t.n.id}`;
  }, 3],
  [(r, k, focus, prob) => {
    const t = target(r, k, focus, prob); if (!t) return;
    t.n.id = pick(r, ["", "zz", t.g.nodes[0]!.id]);
    return `rename node ${t.g.id}/... to ${JSON.stringify(t.n.id)}`;
  }, 3],
  [(r, k) => {
    // A clone of a graph, mutated, placed first or last: first-match lookups.
    const g = pick(r, k.graphs); const c = structuredClone(g);
    if (c.nodes.length > 0) c.nodes.splice(int(r, c.nodes.length), 1);
    if (chance(r, 0.5)) k.graphs.unshift(c); else k.graphs.push(c);
    return `duplicate graph ${g.id} (mutated clone)`;
  }, 4],
  [(r, k) => {
    const [g] = k.graphs.splice(int(r, k.graphs.length), 1);
    return `drop graph ${g!.id}`;
  }, 3],
  [(r, k) => {
    if (k.layers.length === 0) return;
    const [l] = k.layers.splice(int(r, k.layers.length), 1);
    return `drop layer ${l!.id}`;
  }, 3],
  [(r, k) => {
    const l = k.layers.find((x) => x.id === "longterm"); if (!l || l.stores.length === 0) return;
    const [s] = l.stores.splice(int(r, l.stores.length), 1);
    return `drop longterm store ${s}`;
  }, 3],
  [(r, k) => {
    const choice = int(r, 4);
    if (choice === 0) k.frozen.push("ghost");
    else if (choice === 1) k.frozen.push(pick(r, RELEVANT)[1]);
    else if (choice === 2 && k.frozen.length > 0) k.frozen.splice(int(r, k.frozen.length), 1);
    else k.frozen = [];
    return "change frozen";
  }, 4],
  [(_r, k) => { k.twins = []; return "clear twins"; }, 2],
];

function edgeOf(from: string, to: string): LeanEdge {
  return { id: "mut", from, to, fromPort: "out", toPort: "in", kind: "data", cyclic: false, guard: "" };
}

export function genKernels(r: Rng, base: LeanKernel, n: number): KernelCase[] {
  const out: KernelCase[] = [{ id: "k_base", kernel: structuredClone(base), how: [] }];
  for (let i = 0; i < n; i++) {
    const k = structuredClone(base);
    const how: string[] = [];
    for (let m = 1 + int(r, 3); m > 0; m--) {
      const d = weighted(r, MUTATIONS)(r, k, RELEVANT, 0.55);
      if (d !== undefined) how.push(d);
    }
    out.push({ id: `k${i}`, kernel: k, how });
  }
  return out;
}

/** Where each law looks, so guided mutation can aim at the nodes it reads. */
const FOCUS: Record<string, Focus> = {
  frozenTransforms: [["pg-dem", "validate"], ["pg-adl", "holdout"], ["pg-adl", "cut-class"], ["pg-w2l", "structural"], ["pg-dem", "archive"], ["pg-audit", "audit-heuristics"], ["pg-audit", "sample-clean"]],
  structuralIsTransform: [["pg-w2l", "structural"]],
  hybridDeclared: [["pg-w2l", "semantic"], ["pg-w2l", "skill"], ["pg-w2l", "structural"], ["pg-w2l", "hybrid"], ["pg-w2l", "align"], ["pg-w2l", "commit"]],
  authorNotCore: [["pg-dem", "author"]],
  hasSelfAndAuth: [["pg-core", "self-upd"], ["pg-core", "twin-auth"]],
  capTokenPort: [["pg-core", "twin-auth"]],
  hasActionGate: [["pg-twin", "action-gate"], ["pg-twin", "core-bind"]],
  partitionProposeNoInstall: [["pg-adl", "partition-propose"], ["pg-adl", "lineage-record"]],
  reindexNoSpec: [["pg-adl", "reindex"]],
  bindIntersectsTokens: [["pg-twin", "core-bind"]],
  archiveKeepsLosers: [["pg-dem", "register"], ["pg-dem", "archive"]],
  evalHidden: [["pg-dem", "validate"], ["pg-adl", "holdout"]],
  cutClassify: [["pg-adl", "cut-class"], ["pg-adl", "cluster"]],
  auditNotGate: [["pg-audit", "audit-heuristics"], ["pg-audit", "sample-clean"], ["pg-audit", "report"], ["pg-audit", "collect"], ["pg-audit", "model-lint"]],
};

/**
 * For each predicate with a focus, mutants that make the TypeScript mirror say
 * the law is false. Random mutation alone rarely breaks the narrow laws
 * (capTokenPort, bindIntersectsTokens), and a law never seen to fail is a law
 * the comparison has not tested. The mirror only picks inputs; Lean and Bend
 * are still compared on every one.
 */
export function genGuidedKernels(r: Rng, base: LeanKernel, perPredicate: number): KernelCase[] {
  const out: KernelCase[] = [];
  for (const p of KERNEL_PREDICATES) {
    const focus = FOCUS[p.name];
    if (!focus) continue;
    const seen = new Set<string>();
    let found = 0;
    for (let attempt = 0; attempt < 800 && found < perPredicate; attempt++) {
      const k = structuredClone(base);
      const how: string[] = [];
      const d = weighted(r, MUTATIONS)(r, k, focus, 0.95);
      if (d !== undefined) how.push(d);
      const key = JSON.stringify(k);
      if (p.ts(k) || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `g_${p.name}_${found}`, kernel: k, how: [`guided at ${p.name}`, ...how] });
      found++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering. Strings in this corpus are printable ASCII without quotes.

function leanStr(s: string): string {
  return bendStr(s); // same rules: printable ASCII, no quote, no backslash
}
const leanList = (xs: string[]): string => `[${xs.map(leanStr).join(", ")}]`;

function leanNode(n: LeanNode): string {
  const ports = n.ports
    .map((p) => `{ name := ${leanStr(p.name)}, type := ${leanStr(p.type)}, dir := ${p.dir === "in" ? ".«in»" : ".out"} }`)
    .join(", ");
  return `{ id := ${leanStr(n.id)}, kind := .${n.kind}, ports := [${ports}] }`;
}

function leanEdge(e: LeanEdge): string {
  return `{ id := ${leanStr(e.id)}, «from» := ${leanStr(e.from)}, to := ${leanStr(e.to)}, fromPort := ${leanStr(e.fromPort)}, toPort := ${leanStr(e.toPort)}, kind := .${e.kind}, cyclic := ${e.cyclic}, guard := ${leanStr(e.guard)} }`;
}

function leanGraph(g: LeanGraph): string {
  return `{ id := ${leanStr(g.id)}, nodes := [${g.nodes.map(leanNode).join(", ")}], edges := [${g.edges.map(leanEdge).join(", ")}], version := ${leanStr(g.version)} }`;
}

function leanEvent(e: TraceEvent): string {
  const opt = (t?: string): string => (t === undefined ? "none" : `(some ${leanStr(t)})`);
  switch (e.type) {
    case "node.enter": return `.nodeEnter ${leanStr(e.graph)} ${leanStr(e.node)}`;
    case "node.exit": return `.nodeExit ${leanStr(e.graph)} ${leanStr(e.node)}`;
    case "edge.fire": return `.edgeFire ${leanStr(e.edge)}`;
    case "store.read": return `.storeRead ${leanStr(e.store)} ${opt(e.twin)}`;
    case "store.write": return `.storeWrite ${leanStr(e.store)} ${opt(e.twin)}`;
    case "core.permit": return ".corePermit";
    case "core.deny": return ".coreDeny";
    case "core.interrupt": return ".coreInterrupt";
    case "twin.install": return `.twinInstall ${leanStr(e.id)}`;
    case "twin.action": return ".twinAction";
    case "archive.commit": return ".archiveCommit";
    case "archive.sample": return ".archiveSample";
    case "cluster.cut": return ".clusterCut";
    case "cut.classify": return ".cutClassify";
    case "partition.propose": return ".partitionPropose";
    case "cap.mint": return ".capMint";
    case "cap.revoke": return ".capRevoke";
    case "prompt.audit": return ".promptAudit";
    case "steward.ack": return `.stewardAck ${leanStr(e.id)}`;
  }
}

function bendEvent(e: TraceEvent): string {
  const opt = (t?: string): string => (t === undefined ? "None{}" : `Some{${bendStr(t)}}`);
  switch (e.type) {
    case "node.enter": return `T.NodeEnter{${bendStr(e.graph)}, ${bendStr(e.node)}}`;
    case "node.exit": return `T.NodeExit{${bendStr(e.graph)}, ${bendStr(e.node)}}`;
    case "edge.fire": return `T.EdgeFire{${bendStr(e.edge)}}`;
    case "store.read": return `T.StoreRead{${bendStr(e.store)}, ${opt(e.twin)}}`;
    case "store.write": return `T.StoreWrite{${bendStr(e.store)}, ${opt(e.twin)}}`;
    case "core.permit": return "T.CorePermit{}";
    case "core.deny": return "T.CoreDeny{}";
    case "core.interrupt": return "T.CoreInterrupt{}";
    case "twin.install": return `T.TwinInstall{${bendStr(e.id)}}`;
    case "twin.action": return "T.TwinAction{}";
    case "archive.commit": return "T.ArchiveCommit{}";
    case "archive.sample": return "T.ArchiveSample{}";
    case "cluster.cut": return "T.ClusterCut{}";
    case "cut.classify": return "T.CutClassify{}";
    case "partition.propose": return "T.PartitionPropose{}";
    case "cap.mint": return "T.CapMint{}";
    case "cap.revoke": return "T.CapRevoke{}";
    case "prompt.audit": return "T.PromptAudit{}";
    case "steward.ack": return `T.StewardAck{${bendStr(e.id)}}`;
  }
}

/** Intern graphs so a mutated kernel only adds the graphs it changed. */
class GraphTable {
  private byKey = new Map<string, string>();
  readonly order: { name: string; graph: LeanGraph }[] = [];
  name(g: LeanGraph): string {
    const key = JSON.stringify(g);
    let n = this.byKey.get(key);
    if (n === undefined) {
      n = `g${this.order.length}`;
      this.byKey.set(key, n);
      this.order.push({ name: n, graph: g });
    }
    return n;
  }
}

function bendLayer(l: LeanKernel["layers"][number]): string {
  return `K.Layer{${bendStr(l.id)}, ${bendStrList(l.stores)}, ${bendStrList(l.graphIds)}}`;
}

export interface Corpus {
  kernels: KernelCase[];
  traces: TraceCase[];
}

export function renderLean(c: Corpus, base: LeanKernel): string {
  const graphs = new GraphTable();
  const kernelDefs: string[] = [];
  const kernelLit = (id: string, k: LeanKernel): void => {
    const gs = k.graphs.map((g) => graphs.name(g)).join(", ");
    const layers = k.layers
      .map((l) => `{ id := ${leanStr(l.id)}, stores := ${leanList(l.stores)}, graphIds := ${leanList(l.graphIds)} }`)
      .join(", ");
    const twins = k.twins.map((t) => `{ id := ${leanStr(t.id)}, origin := .${t.origin} }`).join(", ");
    kernelDefs.push(
      `def ${id} : Kernel := { spec := ${leanStr(k.spec)}, layers := [${layers}], graphs := [${gs}], twins := [${twins}], frozen := ${leanList(k.frozen)} }`,
    );
  };
  kernelLit("baseKernel", base);
  for (const kc of c.kernels) kernelLit(`c_${kc.id}`, kc.kernel);

  const out: string[] = [];
  out.push("-- GENERATED by `cd helix && bun src/differential.ts`. Not committed.");
  out.push("import Mneme.Kernel");
  out.push("import Mneme.WellFormed");
  out.push("import Mneme.Laws");
  out.push("import Mneme.Trace");
  out.push("open Mneme");
  out.push("");
  out.push("def bit (b : Bool) : String := if b then \"1\" else \"0\"");
  out.push("-- `Laws` is a conjunction of decidable Props; Decidable for the def itself is derived here.");
  out.push("instance (k : Kernel) : Decidable (Laws k) := by unfold Laws; infer_instance");
  out.push("");
  for (const { name, graph } of graphs.order) out.push(`def ${name} : Graph := ${leanGraph(graph)}`);
  out.push("");
  out.push(...kernelDefs);
  out.push("");
  const kp = KERNEL_PREDICATES.map((p) => `bit (${p.lean} k)`).concat(["bit (decide (Laws k))"]).join(", ");
  out.push(`def kreport (id : String) (k : Kernel) : String := String.intercalate " " [id, ${kp}]`);
  const tp = TRACE_PREDICATES.map((p) => `bit (${p.lean})`).join(", ");
  out.push(`def treport (id : String) (t : List Event) : String := String.intercalate " " [id, ${tp}]`);
  out.push("");
  for (const t of c.traces) out.push(`def t_${t.id} : List Event := [${t.events.map(leanEvent).join(", ")}]`);
  out.push("");
  out.push("def lines : List String :=");
  out.push("  [");
  const items = [
    ...c.kernels.map((k) => `kreport "${k.id}" c_${k.id}`),
    ...c.traces.map((t) => `treport "${t.id}" t_${t.id}`),
  ];
  out.push(items.map((s) => `    ${s}`).join(",\n"));
  out.push("  ]");
  out.push("");
  out.push('#eval IO.println (String.intercalate "\\n" lines)');
  return out.join("\n") + "\n";
}

/**
 * Bend returns the reports as one String, and a result past roughly twenty
 * thousand characters overflows its stack. Split the corpus so each file's
 * result stays far below that.
 */
export const BEND_BATCH = 100;

export function bendBatches(c: Corpus): Corpus[] {
  const kernels = c.kernels;
  const traces = c.traces;
  const out: Corpus[] = [];
  for (let i = 0; i < kernels.length; i += BEND_BATCH) out.push({ kernels: kernels.slice(i, i + BEND_BATCH), traces: [] });
  for (let i = 0; i < traces.length; i += BEND_BATCH) out.push({ kernels: [], traces: traces.slice(i, i + BEND_BATCH) });
  return out;
}

export function renderBend(c: Corpus, base: LeanKernel): string {
  const graphs = new GraphTable();
  const kernelDefs: string[] = [];
  const kernelLit = (id: string, k: LeanKernel): void => {
    const gs = k.graphs.map((g) => `${graphs.name(g)}()`).join(", ");
    const layers = k.layers.map(bendLayer).join(", ");
    const twins = k.twins.map((t) => `K.Twin{${bendStr(t.id)}, ${t.origin === "seed" ? "K.Seed{}" : "K.Discovered{}"}}`).join(", ");
    kernelDefs.push(
      `def ${id}() -> K.Kernel:\n  K.Kernel{${bendStr(k.spec)}, [${layers}], [${gs}], [${twins}], ${bendStrList(k.frozen)}}\n`,
    );
  };
  kernelLit("baseKernel", base);
  for (const kc of c.kernels) kernelLit(`c_${kc.id}`, kc.kernel);

  const out: string[] = [];
  out.push("# GENERATED by `cd helix && bun src/differential.ts`. Not committed.");
  out.push("import Base");
  out.push("import ./Kernel.bend as K");
  out.push("import ./Trace.bend as T");
  out.push("import ./WellFormed.bend as W");
  out.push("import ./Decidable.bend as D");
  out.push("");
  out.push("def bit(b: Bool) -> String:\n  match b:\n    case True{}:\n      \"1\"\n    case False{}:\n      \"0\"\n");
  for (const { name, graph } of graphs.order) {
    const nodes = graph.nodes.map(bendNode).join(", ");
    const edges = graph.edges.map(bendEdge).join(", ");
    out.push(`def ${name}() -> K.Graph:\n  K.Graph{${bendStr(graph.id)}, [${nodes}], [${edges}], ${bendStr(graph.version)}}\n`);
  }
  out.push(...kernelDefs);
  const kp = KERNEL_PREDICATES.map((p) => `bit(${p.bend}(k))`).concat(["bit(D.laws(k))"]).join(", ");
  out.push(`def kreport(id: String, +k: K.Kernel) -> String:\n  String.join([id, ${kp}], " ")\n`);
  for (const t of c.traces) {
    out.push(`def t_${t.id}() -> List<&2, T.TraceEvent>:\n  [${t.events.map(bendEvent).join(", ")}]\n`);
  }
  const tp = TRACE_PREDICATES.map((p) => `bit(${p.bend})`).join(", ");
  out.push(`def treport(id: String, +t: List<&2, T.TraceEvent>) -> String:\n  String.join([id, ${tp}], " ")\n`);
  const items = [
    ...c.kernels.map((k) => `kreport("${k.id}", c_${k.id}())`),
    ...c.traces.map((t) => `treport("${t.id}", t_${t.id}())`),
  ];
  // A single list literal of every report overflows Bend's stack; chunk it.
  const CHUNK = 20;
  const parts: string[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    const name = `part${parts.length}`;
    parts.push(name);
    out.push(`def ${name}() -> String:\n  String.join([\n${items.slice(i, i + CHUNK).map((s) => `    ${s}`).join(",\n")}\n  ], "\\n")\n`);
  }
  out.push(`def main() -> String:\n  String.join([${parts.map((n) => `${n}()`).join(", ")}], "\\n")`);
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// The reference column: what the TypeScript mirrors say.

export const COLUMNS: string[] = [
  ...KERNEL_PREDICATES.map((p) => p.name),
  LAWS_PREDICATE,
];
export const TRACE_COLUMNS: string[] = TRACE_PREDICATES.map((p) => p.name);

const bit = (b: boolean): string => (b ? "1" : "0");

export function tsKernelRow(k: LeanKernel): string[] {
  const parts = KERNEL_PREDICATES.map((p) => p.ts(k));
  return [...parts, parts.every(Boolean)].map(bit);
}

export function tsTraceRow(events: TraceEvent[], base: KernelIR): string[] {
  return TRACE_PREDICATES.map((p) => bit(p.ts(events, base)));
}

export const DEFAULT_SEED = 20260824;

export function buildCorpus(
  baseIR: KernelIR,
  opts: { seed?: number; kernels?: number; guided?: number; traces?: number } = {},
): { corpus: Corpus; base: LeanKernel } {
  const r = makeRng(opts.seed ?? DEFAULT_SEED);
  const base = projectKernel(baseIR);
  return {
    base,
    corpus: {
      kernels: [...genKernels(r, base, opts.kernels ?? 100), ...genGuidedKernels(r, base, opts.guided ?? 6)],
      traces: genTraces(r, baseIR, opts.traces ?? 250),
    },
  };
}
