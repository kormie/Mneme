/**
 * Untrusted TypeScript mirrors of the decidable laws in
 * spec/lean/WellFormed.lean and spec/lean/Laws.lean, folded over the
 * Lean-shaped projection (src/lean-kernel.ts) so both sides read the
 * same data. Function names and logic track the Lean `…B` definitions
 * one-to-one; a report from these is never a certificate (ADR-008) —
 * the Lean `by decide` term in proofs/ is.
 */
import {
  findGraph,
  findNode,
  hasOutType,
  hasPortType,
  type LeanGraph,
  type LeanKernel,
} from "./lean-kernel.js";

/** Mirrors Mneme.nodup. */
export function nodup(xs: string[]): boolean {
  return new Set(xs).size === xs.length;
}

function nodeIds(g: LeanGraph): string[] {
  return g.nodes.map((n) => n.id);
}

/** Mirrors Mneme.versioned. */
export function versioned(g: LeanGraph): boolean {
  return g.version.slice(0, 12) === "mneme.graph/";
}

/** Mirrors Mneme.graphWF (INV-G4-VERSIONED per graph). */
export function graphWF(g: LeanGraph): boolean {
  const ids = nodeIds(g);
  return (
    nodup(ids) &&
    g.nodes.every((n) => n.id !== "") &&
    g.edges.every((e) => ids.includes(e.from) && ids.includes(e.to)) &&
    versioned(g)
  );
}

/** Mirrors Mneme.layersFour (INV-LAYERS-FOUR). */
export function layersFour(k: LeanKernel): boolean {
  return ["sensory", "working", "longterm", "core"].every((id) =>
    k.layers.some((l) => l.id === id),
  );
}

/** Mirrors Mneme.longtermStores. */
export function longtermStores(k: LeanKernel): boolean {
  const l = k.layers.find((x) => x.id === "longterm");
  if (!l) return false;
  return ["episodic", "semantic", "skills", "structural", "lineage"].every(
    (s) => l.stores.includes(s),
  );
}

/** Mirrors Mneme.wellFormedB (INV-G1-ENUMERABLE). */
export function wellFormedB(k: LeanKernel): boolean {
  return (
    k.graphs.length > 0 &&
    k.graphs.every(graphWF) &&
    nodup(k.graphs.map((g) => g.id)) &&
    layersFour(k) &&
    longtermStores(k)
  );
}

/** Mirrors Mneme.frozenAreTransformsB (INV-G2-KIND-SPLIT). */
export function frozenAreTransformsB(k: LeanKernel): boolean {
  return k.frozen.every((id) =>
    k.graphs.some((g) =>
      g.nodes.some((n) => n.id === id && n.kind === "transform"),
    ),
  );
}

/** Mirrors Mneme.structuralIsTransformB (INV-STRUCTURAL-NO-MODEL). */
export function structuralIsTransformB(k: LeanKernel): boolean {
  const n = findNode(k, "pg-w2l", "structural");
  return n !== undefined && n.kind === "transform";
}

/** Mirrors Mneme.hybridDeclaredB (INV-HYBRID-DECLARED). */
export function hybridDeclaredB(k: LeanKernel): boolean {
  const g = findGraph(k, "pg-w2l");
  if (!g) return false;
  return ["semantic", "skill", "structural", "hybrid", "align", "commit"].every(
    (id) => g.nodes.some((n) => n.id === id),
  );
}

/** Mirrors Mneme.authorNotCoreB (INV-CORE-NOT-DARWINIAN). */
export function authorNotCoreB(k: LeanKernel): boolean {
  const n = findNode(k, "pg-dem", "author");
  if (!n) return false;
  return !hasOutType(n, "IdentitySnapshot") && !hasOutType(n, "InclusionReport");
}

/** Mirrors Mneme.hasSelfAndAuthB (INV-TWINS-NEVER-WRITE-CORE). */
export function hasSelfAndAuthB(k: LeanKernel): boolean {
  const g = findGraph(k, "pg-core");
  if (!g) return false;
  return (
    g.nodes.some((n) => n.id === "self-upd") &&
    g.nodes.some((n) => n.id === "twin-auth")
  );
}

/** Mirrors Mneme.capTokenPortB (INV-CAP-TOKENS). */
export function capTokenPortB(k: LeanKernel): boolean {
  const n = findNode(k, "pg-core", "twin-auth");
  return n !== undefined && hasPortType(n, "CapToken");
}

/** Mirrors Mneme.twinOriginB (INV-SEEDS-NOT-ONTOLOGY). */
export function twinOriginB(k: LeanKernel): boolean {
  return k.twins.length > 0;
}

/** Mirrors Mneme.hasActionGateB (INV-ACTION-GATE). */
export function hasActionGateB(k: LeanKernel): boolean {
  const g = findGraph(k, "pg-twin");
  if (!g) return false;
  return (
    g.nodes.some((n) => n.id === "action-gate") &&
    g.nodes.some((n) => n.id === "core-bind")
  );
}

/** Mirrors Mneme.partitionProposeNoInstallB (INV-PARTITION-NOT-INSTALL). */
export function partitionProposeNoInstallB(k: LeanKernel): boolean {
  const g = findGraph(k, "pg-adl");
  const n = findNode(k, "pg-adl", "partition-propose");
  if (!g || !n) return false;
  return (
    hasOutType(n, "TwinSpec") &&
    !hasOutType(n, "DomainAck") &&
    !n.ports.some((p) => p.name === "install") &&
    !g.edges.some((e) => e.from === "partition-propose" && e.to === "reindex") &&
    findNode(k, "pg-adl", "lineage-record") !== undefined &&
    g.edges.some(
      (e) => e.from === "partition-propose" && e.to === "lineage-record",
    )
  );
}

/** Mirrors Mneme.reindexNoSpecB (INV-REINDEX-NO-SPEC). */
export function reindexNoSpecB(k: LeanKernel): boolean {
  const n = findNode(k, "pg-adl", "reindex");
  return n !== undefined && !n.ports.some((p) => p.type === "TwinSpec");
}

/** Mirrors Mneme.bindIntersectsTokensB (INV-BIND-INTERSECT). */
export function bindIntersectsTokensB(k: LeanKernel): boolean {
  const n = findNode(k, "pg-twin", "core-bind");
  if (!n) return false;
  return (
    hasPortType(n, "CapToken[]") &&
    !n.ports.some(
      (p) => p.dir === "out" && (p.type === "CapToken[]" || p.type === "CapToken"),
    )
  );
}

/** Mirrors Mneme.archiveKeepsLosersB (INV-ARCHIVE-KEEPS-LOSERS). */
export function archiveKeepsLosersB(k: LeanKernel): boolean {
  const r = findNode(k, "pg-dem", "register");
  const a = findNode(k, "pg-dem", "archive");
  if (!r || !a) return false;
  return hasOutType(r, "LineageArchive") && a.kind === "transform";
}

/** Mirrors Mneme.evalHiddenB (INV-EVAL-HIDDEN). */
export function evalHiddenB(k: LeanKernel): boolean {
  const v = findNode(k, "pg-dem", "validate");
  const h = findNode(k, "pg-adl", "holdout");
  if (!v || !h) return false;
  return v.kind === "transform" && h.kind === "transform";
}

/** Mirrors Mneme.cutClassifyB (INV-CUT-CLASSIFY). */
export function cutClassifyB(k: LeanKernel): boolean {
  const c = findNode(k, "pg-adl", "cut-class");
  const cl = findNode(k, "pg-adl", "cluster");
  if (!c || !cl) return false;
  return c.kind === "transform" && cl.kind === "transform";
}

/** Mirrors Mneme.portRoutableB (INV-PORT-ROUTABLE). */
export function portRoutableB(k: LeanKernel): boolean {
  return k.graphs.every((g) =>
    g.edges.every(
      (e) =>
        e.fromPort !== "" &&
        e.toPort !== "" &&
        (e.kind !== "control" || e.guard !== ""),
    ),
  );
}

/** Mirrors Mneme.auditNotGateB (INV-AUDIT-NOT-GATE). */
export function auditNotGateB(k: LeanKernel): boolean {
  const g = findGraph(k, "pg-audit");
  const h = findNode(k, "pg-audit", "audit-heuristics");
  const s = findNode(k, "pg-audit", "sample-clean");
  if (!g || !h || !s) return false;
  return (
    h.kind === "transform" &&
    s.kind === "transform" &&
    !g.nodes.some(
      (n) =>
        hasOutType(n, "Permit") ||
        hasOutType(n, "ExternalEffect") ||
        hasOutType(n, "TwinId") ||
        hasOutType(n, "CoreStore") ||
        hasOutType(n, "LTM") ||
        hasOutType(n, "LineageArchive"),
    )
  );
}
