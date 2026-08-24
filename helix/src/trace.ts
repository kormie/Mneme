/**
 * mneme.trace/v1 (brief §9). Event payloads mirror the brief and Lean's
 * `Mneme.Trace.Event`; the checker folds below mirror the Lean predicates
 * they are named after. They are untrusted TypeScript (ADR-008): a report
 * from them is never a certificate, only Lean is.
 */
import type { KernelIR } from "./kernel.js";

export type TraceEvent =
  | { type: "node.enter"; graph: string; node: string; t: number }
  | { type: "node.exit"; graph: string; node: string; ports: string[] }
  | { type: "edge.fire"; edge: string; kind: "data" | "control" }
  | { type: "store.read"; store: string; twin?: string; keys: string[] }
  | { type: "store.write"; store: string; twin?: string; keys: string[] }
  | { type: "core.permit" }
  | { type: "core.deny" }
  | { type: "core.interrupt" }
  | { type: "twin.install"; id: string }
  | { type: "twin.action" }
  | { type: "archive.commit" }
  | { type: "archive.sample" }
  | { type: "cluster.cut" }
  | { type: "cut.classify" }
  | { type: "partition.propose" }
  | { type: "cap.mint" }
  | { type: "cap.revoke" }
  | { type: "prompt.audit" }
  | { type: "steward.ack"; id: string };

export interface TraceFile {
  trace: "mneme.trace/v1";
  spec: string;
  events: TraceEvent[];
}

export function makeTraceFile(spec: string, events: TraceEvent[]): TraceFile {
  return { trace: "mneme.trace/v1", spec, events };
}

/** Mirrors Mneme.Trace.validTraceB: every node/edge the log names exists. */
export function validTrace(k: KernelIR, events: TraceEvent[]): boolean {
  return events.every((e) => {
    switch (e.type) {
      case "node.enter":
      case "node.exit":
        return k.graphs.some(
          (g) => g.id === e.graph && g.nodes.some((n) => n.id === e.node),
        );
      case "edge.fire":
        return k.graphs.some((g) => g.edges.some((ed) => ed.id === e.edge));
      default:
        return true;
    }
  });
}

/**
 * Mirrors Mneme.Trace.commitAfterPermitB: every store.write consumes its
 * own preceding core.permit; a permit authorizes exactly one write;
 * core.deny flushes; audit.inbox is exempt (ADR-014).
 */
export function commitAfterPermit(events: TraceEvent[]): boolean {
  let permit = false;
  for (const e of events) {
    if (e.type === "core.permit") permit = true;
    else if (e.type === "core.deny") permit = false;
    else if (e.type === "store.write" && e.store !== "audit.inbox") {
      if (!permit) return false;
      permit = false;
    }
  }
  return true;
}

/** Mirrors Mneme.Trace.denyImpliesInterruptB: G (deny → X interrupt). */
export function denyImpliesInterrupt(events: TraceEvent[]): boolean {
  for (let i = 0; i < events.length; i++) {
    if (events[i]?.type === "core.deny" && events[i + 1]?.type !== "core.interrupt") {
      return false;
    }
  }
  return true;
}

/**
 * Mirrors Mneme.Trace.auditNotEffectB: after prompt.audit, until a
 * non-audit graph is entered, no permit, install, twin.action, or
 * store.write except audit.inbox.
 */
export function auditNotEffect(events: TraceEvent[]): boolean {
  let hot = false;
  for (const e of events) {
    switch (e.type) {
      case "prompt.audit":
        hot = true;
        break;
      case "node.enter":
        if (e.graph !== "pg-audit") hot = false;
        break;
      case "core.permit":
      case "twin.install":
      case "twin.action":
        if (hot) return false;
        break;
      case "store.write":
        if (hot && e.store !== "audit.inbox") return false;
        break;
    }
  }
  return true;
}

/** Mirrors Mneme.Trace.scheduleNonemptyB. */
export function scheduleNonempty(events: TraceEvent[]): boolean {
  return events.some((e) => e.type === "node.enter");
}

/**
 * Mirrors Mneme.Trace.proposeNotInstallB: partition.propose is never
 * immediately followed by twin.install. Necessary, not sufficient —
 * twinIdRequiresInstall is the actual close (ADR-009).
 */
export function proposeNotInstall(events: TraceEvent[]): boolean {
  for (let i = 0; i < events.length; i++) {
    if (
      events[i]?.type === "partition.propose" &&
      events[i + 1]?.type === "twin.install"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Mirrors Mneme.Trace.twinIdRequiresInstallB: store.read/write carrying
 * a twin id requires a prior twin.install of that id.
 */
export function twinIdRequiresInstall(events: TraceEvent[]): boolean {
  const installed: string[] = [];
  for (const e of events) {
    if (e.type === "twin.install") installed.push(e.id);
    else if (
      (e.type === "store.read" || e.type === "store.write") &&
      e.twin !== undefined &&
      !installed.includes(e.twin)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Mirrors Mneme.Trace.installRequiresAckB: twin.install consumes a prior
 * steward.ack for the same id. One ack blesses exactly one install; a
 * replayed ack is a silent install (ADR-014).
 */
export function installRequiresAck(events: TraceEvent[]): boolean {
  const acks: string[] = [];
  for (const e of events) {
    if (e.type === "steward.ack") acks.push(e.id);
    else if (e.type === "twin.install") {
      const i = acks.indexOf(e.id);
      if (i === -1) return false;
      acks.splice(i, 1);
    }
  }
  return true;
}

/** Mirrors Mneme.Trace.hasClusterCutB: at least one cluster.cut. */
export function hasClusterCut(events: TraceEvent[]): boolean {
  return events.some((e) => e.type === "cluster.cut");
}

/** Mirrors Mneme.Trace.hasArchiveSampleB: at least one archive.sample. */
export function hasArchiveSample(events: TraceEvent[]): boolean {
  return events.some((e) => e.type === "archive.sample");
}

export function countType(events: TraceEvent[], type: TraceEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

export function eventHistogram(events: TraceEvent[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const e of events) h[e.type] = (h[e.type] ?? 0) + 1;
  return h;
}
