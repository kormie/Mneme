/**
 * Projection of the kernel IR onto the Lean `Mneme.Kernel` shape
 * (spec/lean/Kernel.lean). This is the single view both sides consume:
 * the untrusted TypeScript judge folds its law mirrors over it, and the
 * Lean exporter serializes it into `proofs/KernelIR.lean` for the
 * `by decide` certificate. Projection only drops fields the Lean
 * structure does not carry: node labels/roles/signatures/bodyHash/
 * promptRefs, edge `xor` (the exclusive-routing marker on pg-adl's
 * a3/a4 and a6/a7 pairs — the Lean `Edge` has no such field, so the
 * certificate is blind to it), graph code/purpose/state/runtime,
 * ingress, fuel, artifact metadata beyond `version`, layer idx/name,
 * twin `never` prose, and the audit policy. Never prompt bodies, which
 * are not in the IR to begin with. It never adds or reinterprets.
 */
import type { KernelIR } from "./kernel.js";

export interface LeanPort {
  name: string;
  type: string;
  dir: "in" | "out";
}

export interface LeanNode {
  id: string;
  kind: "prompt" | "transform";
  ports: LeanPort[];
}

export interface LeanEdge {
  id: string;
  from: string;
  to: string;
  fromPort: string;
  toPort: string;
  kind: "data" | "control";
  cyclic: boolean;
  /** Lean's `Edge.guard` is a plain String; the IR's `null` maps to "". */
  guard: string;
}

export interface LeanGraph {
  id: string;
  nodes: LeanNode[];
  edges: LeanEdge[];
  /** Lean's `Graph.version` is the IR's `artifact.version`. */
  version: string;
}

export interface LeanLayer {
  id: string;
  stores: string[];
  graphIds: string[];
}

export interface LeanTwin {
  id: string;
  origin: "seed" | "discovered";
}

export interface LeanKernel {
  spec: string;
  layers: LeanLayer[];
  graphs: LeanGraph[];
  twins: LeanTwin[];
  frozen: string[];
}

export function projectKernel(k: KernelIR): LeanKernel {
  return {
    spec: k.spec,
    layers: k.layers.map((l) => ({
      id: l.id,
      stores: [...l.stores],
      graphIds: [...l.graphIds],
    })),
    graphs: k.graphs.map((g) => ({
      id: g.id,
      nodes: g.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        ports: n.ports.map((p) => ({ name: p.name, type: p.type, dir: p.dir })),
      })),
      edges: g.edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        fromPort: e.fromPort,
        toPort: e.toPort,
        kind: e.kind,
        cyclic: e.cyclic,
        guard: e.guard ?? "",
      })),
      version: g.artifact.version,
    })),
    twins: k.twins.map((t) => ({ id: t.id, origin: t.origin })),
    frozen: [...k.frozen],
  };
}

/** Mirrors Lean `Kernel.findGraph`. */
export function findGraph(k: LeanKernel, id: string): LeanGraph | undefined {
  return k.graphs.find((g) => g.id === id);
}

/** Mirrors Lean `Kernel.findNode`. */
export function findNode(
  k: LeanKernel,
  graphId: string,
  nodeId: string,
): LeanNode | undefined {
  return findGraph(k, graphId)?.nodes.find((n) => n.id === nodeId);
}

/** Mirrors Lean `Node.hasPortType`. */
export function hasPortType(n: LeanNode, ty: string): boolean {
  return n.ports.some((p) => p.type === ty);
}

/** Mirrors Lean `Node.hasOutType`. */
export function hasOutType(n: LeanNode, ty: string): boolean {
  return n.ports.some((p) => p.dir === "out" && p.type === ty);
}
