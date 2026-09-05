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

export interface IngressBinding {
  name: string;
  type: string;
}

export interface Graph {
  id: string;
  code: string;
  purpose: string;
  state: string;
  runtime: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  ingress: IngressBinding[];
  /** Cyclic edge id → maximum fires per run (INV-PORT-ROUTABLE). */
  fuel: Record<string, number>;
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

const KERNEL_KEYS = ["spec", "layers", "graphs", "twins", "frozen", "auditPolicy"] as const;
const LAYER_KEYS = ["id", "idx", "name", "stores", "graphIds"] as const;
const GRAPH_KEYS = [
  "id",
  "code",
  "purpose",
  "state",
  "runtime",
  "nodes",
  "edges",
  "ingress",
  "fuel",
  "artifact",
] as const;
const NODE_KEYS = [
  "id",
  "label",
  "kind",
  "role",
  "ports",
  "signature",
  "bodyHash",
  "promptRef",
] as const;
const PORT_KEYS = ["name", "type", "dir"] as const;
const EDGE_KEYS = [
  "id",
  "from",
  "to",
  "fromPort",
  "toPort",
  "kind",
  "cyclic",
  "guard",
  "xor",
] as const;
const INGRESS_KEYS = ["name", "type"] as const;
const ARTIFACT_KEYS = [
  "version",
  "inspect",
  "versioning",
  "validation",
  "optimization",
  "hash",
] as const;
const TWIN_KEYS = ["id", "origin", "never"] as const;
const AUDIT_POLICY_KEYS = ["sampleRate", "sampleFloor", "spike"] as const;

function field(path: string, name: string): string {
  return path.length === 0 ? name : `${path}.${name}`;
}

function fail(path: string, expected: string): never {
  throw new Error(`kernel ${path.length === 0 ? "<root>" : path}: expected ${expected}`);
}

function expectObject(
  value: unknown,
  path: string,
  keys?: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, "an object");
  }
  const object = value as Record<string, unknown>;
  if (keys !== undefined) {
    const unknown = Object.keys(object).find((key) => !keys.includes(key));
    if (unknown !== undefined) {
      throw new Error(`kernel ${field(path, unknown)}: unrecognized field`);
    }
  }
  return object;
}

function expectArray(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : fail(path, "an array");
}

function expectString(value: unknown, path: string): string {
  return typeof value === "string" ? value : fail(path, "a string");
}

function expectNullableString(value: unknown, path: string): string | null {
  return value === null || typeof value === "string"
    ? value
    : fail(path, "a string or null");
}

function expectBoolean(value: unknown, path: string): boolean {
  return typeof value === "boolean" ? value : fail(path, "a boolean");
}

function expectNumber(value: unknown, path: string): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fail(path, "a finite number");
}

function expectOneOf<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): T[number] {
  if (typeof value === "string" && allowed.some((candidate) => candidate === value)) {
    return value as T[number];
  }
  return fail(path, allowed.map((candidate) => JSON.stringify(candidate)).join(" or "));
}

function expectStringArray(value: unknown, path: string): string[] {
  const array = expectArray(value, path);
  return array.map((item, index) => expectString(item, `${path}[${index}]`));
}

function assertPort(value: unknown, path: string): asserts value is Port {
  const port = expectObject(value, path, PORT_KEYS);
  expectString(port.name, field(path, "name"));
  expectString(port.type, field(path, "type"));
  expectOneOf(port.dir, field(path, "dir"), ["in", "out"] as const);
}

function assertNode(value: unknown, path: string): asserts value is GraphNode {
  const node = expectObject(value, path, NODE_KEYS);
  expectString(node.id, field(path, "id"));
  expectString(node.label, field(path, "label"));
  expectOneOf(node.kind, field(path, "kind"), ["prompt", "transform"] as const);
  expectString(node.role, field(path, "role"));
  const ports = expectArray(node.ports, field(path, "ports"));
  for (let index = 0; index < ports.length; index += 1) {
    assertPort(ports[index], `${field(path, "ports")}[${index}]`);
  }
  expectNullableString(node.signature, field(path, "signature"));
  expectNullableString(node.bodyHash, field(path, "bodyHash"));
  expectNullableString(node.promptRef, field(path, "promptRef"));
}

function assertEdge(value: unknown, path: string): asserts value is GraphEdge {
  const edge = expectObject(value, path, EDGE_KEYS);
  expectString(edge.id, field(path, "id"));
  expectString(edge.from, field(path, "from"));
  expectString(edge.to, field(path, "to"));
  expectString(edge.fromPort, field(path, "fromPort"));
  expectString(edge.toPort, field(path, "toPort"));
  expectOneOf(edge.kind, field(path, "kind"), ["data", "control"] as const);
  expectBoolean(edge.cyclic, field(path, "cyclic"));
  expectNullableString(edge.guard, field(path, "guard"));
  expectNullableString(edge.xor, field(path, "xor"));
}

function assertIngress(value: unknown, path: string): asserts value is IngressBinding {
  const ingress = expectObject(value, path, INGRESS_KEYS);
  expectString(ingress.name, field(path, "name"));
  expectString(ingress.type, field(path, "type"));
}

function assertArtifact(value: unknown, path: string): asserts value is GraphArtifactMeta {
  const artifact = expectObject(value, path, ARTIFACT_KEYS);
  expectString(artifact.version, field(path, "version"));
  expectString(artifact.inspect, field(path, "inspect"));
  expectString(artifact.versioning, field(path, "versioning"));
  expectString(artifact.validation, field(path, "validation"));
  expectString(artifact.optimization, field(path, "optimization"));
  expectString(artifact.hash, field(path, "hash"));
}

function assertGraph(value: unknown, path: string): asserts value is Graph {
  const graph = expectObject(value, path, GRAPH_KEYS);
  expectString(graph.id, field(path, "id"));
  expectString(graph.code, field(path, "code"));
  expectString(graph.purpose, field(path, "purpose"));
  expectString(graph.state, field(path, "state"));
  expectString(graph.runtime, field(path, "runtime"));

  const nodes = expectArray(graph.nodes, field(path, "nodes"));
  const nodePorts = new Map<string, Set<string>>();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    assertNode(node, `${field(path, "nodes")}[${index}]`);
    // Duplicate ids remain the law fold's concern. Mirror the scheduler's
    // Map construction so reference checks use the last declared node.
    nodePorts.set(node.id, new Set(node.ports.map((port) => port.name)));
  }

  const edges = expectArray(graph.edges, field(path, "edges"));
  for (let index = 0; index < edges.length; index += 1) {
    const edgePath = `${field(path, "edges")}[${index}]`;
    const edge = edges[index];
    assertEdge(edge, edgePath);
    const fromPorts = nodePorts.get(edge.from);
    if (fromPorts === undefined) {
      fail(field(edgePath, "from"), `a node id declared in ${field(path, "nodes")}`);
    }
    const toPorts = nodePorts.get(edge.to);
    if (toPorts === undefined) {
      fail(field(edgePath, "to"), `a node id declared in ${field(path, "nodes")}`);
    }
    if (!fromPorts.has(edge.fromPort)) {
      fail(field(edgePath, "fromPort"), `a port declared on node ${JSON.stringify(edge.from)}`);
    }
    if (!toPorts.has(edge.toPort)) {
      fail(field(edgePath, "toPort"), `a port declared on node ${JSON.stringify(edge.to)}`);
    }
  }

  const ingress = expectArray(graph.ingress, field(path, "ingress"));
  for (let index = 0; index < ingress.length; index += 1) {
    assertIngress(ingress[index], `${field(path, "ingress")}[${index}]`);
  }

  const fuel = expectObject(graph.fuel, field(path, "fuel"));
  for (const [edgeId, value] of Object.entries(fuel)) {
    expectNumber(value, field(field(path, "fuel"), edgeId));
  }
  assertArtifact(graph.artifact, field(path, "artifact"));
}

function assertLayer(value: unknown, path: string): asserts value is Layer {
  const layer = expectObject(value, path, LAYER_KEYS);
  expectString(layer.id, field(path, "id"));
  expectString(layer.idx, field(path, "idx"));
  expectString(layer.name, field(path, "name"));
  expectStringArray(layer.stores, field(path, "stores"));
  expectStringArray(layer.graphIds, field(path, "graphIds"));
}

function assertTwin(value: unknown, path: string): asserts value is Twin {
  const twin = expectObject(value, path, TWIN_KEYS);
  expectString(twin.id, field(path, "id"));
  expectOneOf(twin.origin, field(path, "origin"), ["seed", "discovered"] as const);
  expectString(twin.never, field(path, "never"));
}

function assertAuditPolicy(value: unknown, path: string): asserts value is AuditPolicy {
  const policy = expectObject(value, path, AUDIT_POLICY_KEYS);
  expectNumber(policy.sampleRate, field(path, "sampleRate"));
  expectNumber(policy.sampleFloor, field(path, "sampleFloor"));
  expectNumber(policy.spike, field(path, "spike"));
}

function assertKernel(value: unknown): asserts value is KernelIR {
  const kernel = expectObject(value, "", KERNEL_KEYS);
  expectString(kernel.spec, "spec");

  const layers = expectArray(kernel.layers, "layers");
  for (let index = 0; index < layers.length; index += 1) {
    assertLayer(layers[index], `layers[${index}]`);
  }

  const graphs = expectArray(kernel.graphs, "graphs");
  for (let index = 0; index < graphs.length; index += 1) {
    assertGraph(graphs[index], `graphs[${index}]`);
  }

  const twins = expectArray(kernel.twins, "twins");
  for (let index = 0; index < twins.length; index += 1) {
    assertTwin(twins[index], `twins[${index}]`);
  }
  expectStringArray(kernel.frozen, "frozen");
  assertAuditPolicy(kernel.auditPolicy, "auditPolicy");
}

export function loadKernel(path: string = KERNEL_PATH): KernelIR {
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `kernel file ${path} is not JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  assertKernel(parsed);
  return parsed;
}
