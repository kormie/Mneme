/**
 * Kernel IR loader. The IR at spec/kernel.json is normative (ADR-002);
 * these types mirror its shapes and Lean's `Mneme.Kernel`, they do not
 * extend them. Deepen types here only to match what the IR already says.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const KERNEL_PATH = resolve(HERE, "../../spec/kernel.json");

export type NodeKind = "prompt" | "transform";
export type EdgeKind = "data" | "control";
export type PortDir = "in" | "out";

export interface Port {
  name: string;
  type: string;
  dir: PortDir;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  role: string;
  ports: Port[];
  signature: string | null;
  bodyHash: string | null;
  promptRef: string | null;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  fromPort: string;
  toPort: string;
  kind: EdgeKind;
  cyclic: boolean;
  guard: string | null;
  xor: string | null;
}

export interface GraphArtifactMeta {
  version: string;
  inspect: string;
  versioning: string;
  validation: string;
  optimization: string;
  hash: string;
}

export interface Graph {
  id: string;
  code: string;
  purpose: string;
  state: unknown;
  runtime: unknown;
  nodes: GraphNode[];
  edges: GraphEdge[];
  ingress: unknown;
  fuel: unknown;
  artifact: GraphArtifactMeta;
}

export interface Layer {
  id: string;
  idx: string;
  name: string;
  stores: string[];
  graphIds: string[];
}

export interface Twin {
  id: string;
  origin: "seed" | "discovered";
  never: string;
}

export interface AuditPolicy {
  sampleRate: number;
  sampleFloor: number;
  spike: number;
}

export interface KernelIR {
  spec: string;
  layers: Layer[];
  graphs: Graph[];
  twins: Twin[];
  frozen: string[];
  auditPolicy: AuditPolicy;
}

export function loadKernel(path: string = KERNEL_PATH): KernelIR {
  return JSON.parse(readFileSync(path, "utf8")) as KernelIR;
}
