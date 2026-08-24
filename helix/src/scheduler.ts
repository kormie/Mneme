/**
 * Pure scheduler over the kernel IR (ADR-013). It routes declared edges
 * only, never invents wiring, and never reads prompt bodies to branch
 * (ADR-011): control flow comes from edge guards evaluated over port
 * values. Node behaviour is supplied by the caller as appliers; the
 * scheduler itself makes no model calls and touches no stores.
 */
import type { GraphEdge, GraphNode, KernelIR } from "./kernel.js";
import type { TraceEvent } from "./trace.js";

export type PortValues = Record<string, unknown>;

/** Emitted store/core events an applier may record while a node runs. */
export interface NodeCtx {
  emit(event: TraceEvent): void;
}

export type Applier = (inputs: PortValues, ctx: NodeCtx) => PortValues;

/** Keyed "<graphId>/<nodeId>". Every node that becomes runnable needs one. */
export type Appliers = Record<string, Applier>;

export interface Emitter {
  events: TraceEvent[];
  emit(event: TraceEvent): void;
}

export function makeEmitter(): Emitter {
  const events: TraceEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

/** In-port types ending in `?` are optional (brief §7 signatures). */
export function isOptionalType(t: string): boolean {
  return t.endsWith("?");
}

type Literal = null | boolean | number | string;

function parseLiteral(tok: string): Literal | undefined {
  if (tok === "null") return null;
  if (tok === "true") return true;
  if (tok === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) return tok; // bare word = string
  return undefined;
}

function resolvePath(root: unknown, path: string[]): unknown {
  let v = root;
  for (const seg of path) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[seg];
  }
  return v;
}

/**
 * Evaluate a guard like `verdict.kind == pass`, `flag != null`,
 * `ack.rehearse == true`, or `true`, against the routed port value.
 * The left path's first segment must be the edge's fromPort. Anything
 * this cannot resolve is an error, never a silent branch.
 */
export function evalGuard(guard: string, fromPort: string, value: unknown): boolean {
  const g = guard.trim();
  if (g === "true") return true;
  const m = g.match(/^([A-Za-z_][\w.]*)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (!m) throw new Error(`unsupported guard: ${guard}`);
  const [, lhsPath, op, rhsTok] = m as unknown as [string, string, string, string];
  const segs = lhsPath.split(".");
  if (segs[0] !== fromPort) {
    throw new Error(`guard root '${segs[0]}' is not port '${fromPort}': ${guard}`);
  }
  const lhs = resolvePath(value, segs.slice(1));
  const rhs = parseLiteral(rhsTok.trim());
  if (rhs === undefined) throw new Error(`unsupported guard literal: ${guard}`);
  switch (op) {
    case "==":
      return lhs === rhs;
    case "!=":
      return lhs !== rhs;
    default: {
      if (typeof lhs !== "number" || typeof rhs !== "number") {
        throw new Error(`ordered guard on non-numbers: ${guard}`);
      }
      if (op === "<") return lhs < rhs;
      if (op === "<=") return lhs <= rhs;
      if (op === ">") return lhs > rhs;
      return lhs >= rhs;
    }
  }
}

interface NodeState {
  node: GraphNode;
  bound: PortValues;
  runs: number;
  armed: boolean;
}

/**
 * Run one graph invocation. `ingress` binds graph-level inputs by name to
 * in-ports that no edge feeds (INV-PORT-ROUTABLE). A node runs when every
 * required in-port is bound, at least one in-port is bound (or it has
 * none), and every non-cyclic in-edge is settled (its source ran or can
 * never run). Data edges fire when the produced value is non-null; control
 * edges additionally require their guard. Cyclic edges re-arm the target
 * and spend declared fuel.
 */
export function runGraph(
  kernel: KernelIR,
  graphId: string,
  ingress: PortValues,
  appliers: Appliers,
  emitter: Emitter,
): Map<string, PortValues> {
  const graph = kernel.graphs.find((g) => g.id === graphId);
  if (!graph) throw new Error(`unknown graph: ${graphId}`);
  for (const name of Object.keys(ingress)) {
    if (!graph.ingress.some((i) => i.name === name)) {
      throw new Error(`${graphId}: ingress '${name}' not declared in the kernel`);
    }
  }

  const states = new Map<string, NodeState>();
  for (const n of graph.nodes) {
    states.set(n.id, { node: n, bound: {}, runs: 0, armed: false });
  }
  const inEdges = (n: GraphNode): GraphEdge[] => graph.edges.filter((e) => e.to === n.id);
  const outEdges = (n: GraphNode): GraphEdge[] => graph.edges.filter((e) => e.from === n.id);

  // Ingress binds only ports no edge feeds; edges stay the only wiring.
  for (const st of states.values()) {
    for (const p of st.node.ports) {
      if (p.dir !== "in") continue;
      const fed = inEdges(st.node).some((e) => e.toPort === p.name);
      if (!fed && p.name in ingress) st.bound[p.name] = ingress[p.name];
    }
  }

  const fuelSpent = new Map<string, number>();
  const outputs = new Map<string, PortValues>();

  const requiredBound = (st: NodeState): boolean =>
    st.node.ports.every(
      (p) => p.dir !== "in" || isOptionalType(p.type) || p.name in st.bound,
    );
  const anyBound = (st: NodeState): boolean =>
    st.node.ports.every((p) => p.dir !== "in") ||
    Object.keys(st.bound).length > 0;

  /**
   * Nodes that might still run: unrun (or re-armed) nodes whose required
   * in-ports are each bound already or fed by an edge from another node
   * that might still run. Greatest fixpoint; over-approximation only
   * delays a node, it never invents an execution.
   */
  const computePotential = (): Set<string> => {
    const pot = new Set<string>();
    for (const n of graph.nodes) {
      const st = states.get(n.id)!;
      if (st.runs === 0 || st.armed) pot.add(n.id);
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (const id of [...pot]) {
        const st = states.get(id)!;
        const feasible = st.node.ports.every((p) => {
          if (p.dir !== "in" || isOptionalType(p.type) || p.name in st.bound) return true;
          return inEdges(st.node).some((e) => e.toPort === p.name && pot.has(e.from));
        });
        if (!feasible) {
          pot.delete(id);
          changed = true;
        }
      }
    }
    return pot;
  };

  // An in-edge is settled once its source ran or can no longer run.
  const settled = (st: NodeState, pot: Set<string>): boolean =>
    inEdges(st.node).every((e) => {
      if (e.cyclic) return true;
      const src = states.get(e.from);
      if (!src) throw new Error(`${graphId}: edge ${e.id} from unknown node ${e.from}`);
      return src.runs > 0 || !pot.has(e.from);
    });

  const runnable = (st: NodeState, pot: Set<string>): boolean =>
    (st.runs === 0 || st.armed) && requiredBound(st) && anyBound(st) && settled(st, pot);

  const fireEdge = (e: GraphEdge, value: unknown): void => {
    if (e.kind === "control" && !evalGuard(e.guard ?? "true", e.fromPort, value)) return;
    if (value === null || value === undefined) return;
    if (e.cyclic) {
      const max = graph.fuel[e.id];
      if (max === undefined) throw new Error(`cyclic edge ${e.id} has no declared fuel`);
      const spent = fuelSpent.get(e.id) ?? 0;
      if (spent >= max) return;
      fuelSpent.set(e.id, spent + 1);
    }
    const dst = states.get(e.to);
    if (!dst) throw new Error(`${graphId}: edge ${e.id} into unknown node ${e.to}`);
    dst.bound[e.toPort] = value;
    if (e.cyclic) dst.armed = true;
    emitter.emit({ type: "edge.fire", edge: e.id, kind: e.kind });
  };

  for (;;) {
    const pot = computePotential();
    const next = graph.nodes.find((n) => runnable(states.get(n.id)!, pot));
    if (!next) break;
    const st = states.get(next.id)!;
    st.armed = false;
    st.runs += 1;
    const applier = appliers[`${graphId}/${next.id}`];
    if (!applier) throw new Error(`no applier for ${graphId}/${next.id}`);
    emitter.emit({ type: "node.enter", graph: graphId, node: next.id, t: emitter.events.length });
    const out = applier({ ...st.bound }, { emit: emitter.emit });
    emitter.emit({
      type: "node.exit",
      graph: graphId,
      node: next.id,
      ports: Object.keys(out).filter((k) => out[k] !== undefined),
    });
    outputs.set(next.id, out);
    for (const e of outEdges(next)) {
      if (e.fromPort in out) fireEdge(e, out[e.fromPort]);
    }
  }

  return outputs;
}
