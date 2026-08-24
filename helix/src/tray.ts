/**
 * Desk-tray dogfood (ADR-013 slice). A local-only CLI: the operator drops
 * their own markdown notes into an inbox directory; the scheduler runs the
 * declared kernel graphs over them and emits a mneme.trace/v1 file.
 *
 * Everything here is offline and deterministic. Prompt nodes run local
 * stand-in appliers — no model, no network. Frozen-surface transforms
 * (structural, audit-heuristics, sample-clean) get minimal stand-ins whose
 * real definitions are steward-held; they are marked below and must not be
 * mistaken for canon. The Core store ships empty: the stand-in ValueFilter
 * refuses to interpret steward-authored clauses, so a non-empty
 * constitution needs a real ValueFilter first.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { loadKernel, type KernelIR } from "./kernel.js";
import { makeEmitter, runGraph, type Appliers, type Emitter } from "./scheduler.js";
import {
  auditNotEffect,
  commitAfterPermit,
  countType,
  denyImpliesInterrupt,
  eventHistogram,
  makeTraceFile,
  scheduleNonempty,
  validTrace,
  type TraceEvent,
  type TraceFile,
} from "./trace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELIX_ROOT = resolve(HERE, "..");
const SPEC_ROOT = resolve(HELIX_ROOT, "../spec");

interface RawPacket {
  id: string;
  channel: "file";
  text: string;
}

interface Observation {
  id: string;
  source: string;
  title: string;
  headings: string[];
  lines: number;
  text: string;
}

interface Episode {
  id: string;
  note: string;
  title: string;
  headings: string[];
  lines: number;
}

interface Triple {
  s: string;
  p: string;
  o: string;
}

interface WriteItem {
  store: "episodic" | "semantic";
  key: string;
  value: unknown;
}

function firstHeading(text: string): string | null {
  for (const line of text.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.*\S)/);
    if (m) return m[1] ?? null;
  }
  return null;
}

function headings(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.match(/^#{2,6}\s+(.*\S)/)?.[1])
    .filter((h): h is string => h !== undefined);
}

/**
 * Build the tray appliers. Effects (store.read/write, core.permit) are
 * emitted by appliers through ctx; routing stays the scheduler's alone.
 */
function trayAppliers(kernel: KernelIR, emitter: Emitter): Appliers {
  const coreStore = { values: [] as string[], goals: [] as string[], style: {} };

  const appliers: Appliers = {
    // --- pg-s2w: inbox files → working-memory slots -------------------
    "pg-s2w/sensor-normalize": (inputs, ctx) => {
      const raw = inputs.raw as RawPacket[];
      ctx.emit({ type: "store.read", store: "buffer", keys: raw.map((p) => p.id) });
      const obs: Observation[] = raw.map((p) => ({
        id: p.id,
        source: p.id,
        title: firstHeading(p.text) ?? p.id,
        headings: headings(p.text),
        lines: p.text.split("\n").filter((l) => l.trim() !== "").length,
        text: p.text,
      }));
      return { obs };
    },
    // Offline stand-in: uniform salience, no model call.
    "pg-s2w/salience": (inputs) => {
      const obs = inputs.obs as Observation[];
      return {
        scored: obs.map((o) => ({ obs: o, salience: 1, rationale: "offline stand-in" })),
      };
    },
    // Offline stand-in: the tray never flags its own inbox as anomalous.
    "pg-s2w/anomaly": () => ({ flag: null }),
    "pg-s2w/gate": (inputs) => {
      const scored = inputs.scored as { obs: Observation; salience: number }[];
      return { selected: scored.slice(0, 8).map((s) => s.obs) };
    },
    "pg-s2w/style": () => ({ style: { tone: "plain" } }),
    "pg-s2w/bind": (inputs) => {
      const selected = inputs.selected as Observation[];
      return {
        slots: selected.map((o) => ({ id: `slot:${o.id}`, obs: o })),
        dropped: [],
      };
    },

    // --- pg-w2l write path: slots → LTM commits -----------------------
    "pg-w2l/episode": (inputs) => {
      const trace = inputs.trace as { slots: { obs: Observation }[] };
      const episodes: Episode[] = trace.slots.map(({ obs }) => ({
        id: `ep:${obs.id}`,
        note: obs.id,
        title: obs.title,
        headings: obs.headings,
        lines: obs.lines,
      }));
      return { episodes };
    },
    // Offline stand-in: keep everything; compression needs a model.
    "pg-w2l/rehearse": (inputs) => ({
      kept: inputs.episodes as Episode[],
      decision: "keep",
    }),
    // Offline stand-in: syntactic triples only (title and headings).
    "pg-w2l/semantic": (inputs) => {
      const kept = inputs.kept as Episode[];
      const triples: Triple[] = kept.flatMap((ep) => [
        { s: ep.note, p: "titled", o: ep.title },
        ...ep.headings.map((h) => ({ s: ep.note, p: "heading", o: h })),
      ]);
      return { triples };
    },
    // Offline stand-in: personal notes yield no procedural skill graphs.
    "pg-w2l/skill": () => ({ skill: null }),
    // FROZEN surface (structural). Steward-held; this stand-in asserts
    // nothing: no structural claims from an offline heuristic.
    "pg-w2l/structural": () => ({ edges: [] }),
    "pg-w2l/conflict": (inputs) => {
      const triples = inputs.triples as Triple[];
      const kept = new Map<string, Triple[]>();
      for (const t of triples) kept.set(t.s, [...(kept.get(t.s) ?? []), t]);
      return { resolved: { triplesByNote: Object.fromEntries(kept), contradictions: [] } };
    },
    "pg-w2l/align": (inputs) => ({
      verdict: { kind: "pass", clauses: [] },
      write: inputs.resolved,
    }),
    "pg-w2l/commit": (inputs, ctx) => {
      const write = inputs.write as { triplesByNote: Record<string, Triple[]> };
      let written = 0;
      for (const item of commitItems(write)) {
        const verdict = requestPermit(item);
        if (verdict !== "pass") continue; // deny already flushed the permit
        ctx.emit({ type: "store.write", store: item.store, keys: [item.key] });
        written += 1;
      }
      return { ack: { rehearse: false, written } };
    },

    // --- pg-core: one ValueFilter pass per commit item ----------------
    "pg-core/id-read": (inputs, ctx) => {
      const store = inputs.core_store as typeof coreStore;
      ctx.emit({ type: "store.read", store: "values", keys: ["clauses"] });
      return { snapshot: { values: store.values, goals: store.goals, style: store.style } };
    },
    // Offline stand-in: an empty constitution constrains nothing, so the
    // proposal passes. Steward-authored clauses need a real ValueFilter;
    // this stand-in refuses to pretend to interpret them.
    "pg-core/value-filter": (inputs, ctx) => {
      const snapshot = inputs.snapshot as { values: string[] };
      if (snapshot.values.length > 0) {
        throw new Error(
          "tray value-filter stand-in cannot interpret steward-authored clauses",
        );
      }
      ctx.emit({ type: "core.permit" });
      return { verdict: { kind: "pass", cited_clauses: [] } };
    },

    // --- pg-audit: lint the pg-w2l prompt corpus, report to steward ---
    "pg-audit/collect": (inputs) => {
      const artifact = inputs.artifact as { graph: string };
      const g = kernel.graphs.find((x) => x.id === artifact.graph);
      if (!g) throw new Error(`audit target not in kernel: ${artifact.graph}`);
      const files = g.nodes
        .filter((n) => n.promptRef !== null)
        .map((n) => ({
          path: n.promptRef as string,
          text: readFileSync(join(SPEC_ROOT, n.promptRef as string), "utf8"),
        }));
      return { files };
    },
    // FROZEN surface (audit-heuristics). Steward-held; minimal stand-in
    // for ADR-012's three categories, not the canonical rule set.
    "pg-audit/audit-heuristics": (inputs) => {
      const files = inputs.files as { path: string; text: string }[];
      const rules: [string, RegExp][] = [
        ["capability-language", /\byou (may|can|are allowed to)\b/i],
        ["twin-id-convention", /\b(soma|agora|oikos|nomos|twin[-_ ]?id)\b/i],
        ["routing-by-convention", /\b(route to|go to node|next node)\b/i],
      ];
      const flags = files.flatMap((f) =>
        rules
          .filter(([, re]) => re.test(f.text))
          .map(([category]) => ({ file: f.path, category })),
      );
      return { flags };
    },
    // Offline stand-in: ModelLint is a prompt node; without a model it
    // contributes no flags (and is untrusted either way, ADR-012).
    "pg-audit/model-lint": () => ({ flags: [] }),
    // FROZEN surface (sample-clean). Steward-held; stand-in applies the
    // declared auditPolicy (rate, floor) to unflagged files, in path order.
    "pg-audit/sample-clean": (inputs) => {
      const files = inputs.files as { path: string; text: string }[];
      const flags = inputs.flags as { file: string }[];
      const policy = inputs.policy as { sampleRate: number; sampleFloor: number };
      const flagged = new Set(flags.map((f) => f.file));
      const clean = files.filter((f) => !flagged.has(f.path)).sort((a, b) =>
        a.path < b.path ? -1 : 1,
      );
      const n = Math.max(policy.sampleFloor, Math.ceil(policy.sampleRate * files.length));
      return { sample: clean.slice(0, n) };
    },
    "pg-audit/report": (inputs, ctx) => {
      const heur = inputs.heur as { file: string; category: string }[];
      const model = inputs.model as unknown[];
      const sample = inputs.sample as { path: string }[];
      const audit = {
        flags: heur.length + model.length,
        heuristic: heur,
        cleanSample: sample.map((s) => s.path),
      };
      ctx.emit({ type: "prompt.audit" });
      ctx.emit({ type: "store.write", store: "audit.inbox", keys: ["prompt-audit"] });
      return { audit, inbox: { report: audit }, trend: { flagRate: heur.length } };
    },
  };

  function commitItems(write: { triplesByNote: Record<string, Triple[]> }): WriteItem[] {
    const notes = Object.keys(write.triplesByNote).sort();
    return notes.flatMap((note): WriteItem[] => [
      { store: "episodic", key: `ep:${note}`, value: { note } },
      { store: "semantic", key: note, value: write.triplesByNote[note] },
    ]);
  }

  /**
   * Consult Core for one write item: a full pg-core invocation whose
   * ValueFilter emits core.permit on pass. One run per item — a permit
   * authorizes exactly one write (ADR-014), never amortized.
   */
  function requestPermit(item: WriteItem): string {
    const out = runGraph(
      kernel,
      "pg-core",
      { core_store: coreStore, proposal: { store: item.store, key: item.key } },
      appliers,
      emitter,
    );
    const verdict = out.get("value-filter")?.verdict as { kind: string } | undefined;
    return verdict?.kind ?? "no-verdict";
  }

  return appliers;
}

export interface TrayReport {
  notes: string[];
  episodes: Episode[];
  triples: Triple[];
  auditFlags: number;
  trace: TraceFile;
  checks: {
    validTrace: boolean;
    scheduleNonempty: boolean;
    commitAfterPermit: boolean;
    denyImpliesInterrupt: boolean;
    auditNotEffect: boolean;
  };
  permitPairs: { writeIndex: number; store: string; permitIndex: number }[];
  counts: Record<string, number>;
}

/** Pair each non-audit store.write with the core.permit it consumed. */
export function permitPairing(
  events: TraceEvent[],
): { writeIndex: number; store: string; permitIndex: number }[] {
  const pairs: { writeIndex: number; store: string; permitIndex: number }[] = [];
  let permitIndex = -1;
  events.forEach((e, i) => {
    if (e.type === "core.permit") permitIndex = i;
    else if (e.type === "core.deny") permitIndex = -1;
    else if (e.type === "store.write" && e.store !== "audit.inbox") {
      pairs.push({ writeIndex: i, store: e.store, permitIndex });
      permitIndex = -1;
    }
  });
  return pairs;
}

export function runTray(inboxDir: string, kernel: KernelIR = loadKernel()): TrayReport {
  const files = readdirSync(inboxDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (files.length === 0) throw new Error(`no .md notes in inbox: ${inboxDir}`);
  const raw: RawPacket[] = files.map((f) => ({
    id: basename(f),
    channel: "file",
    text: readFileSync(join(inboxDir, f), "utf8"),
  }));

  const emitter = makeEmitter();
  const appliers = trayAppliers(kernel, emitter);
  const identity = { values: [], goals: [], style: {} };

  const s2w = runGraph(
    kernel,
    "pg-s2w",
    { raw, identity, slot_schema: { maxSlots: 8 } },
    appliers,
    emitter,
  );
  const slots = s2w.get("bind")?.slots as { obs: Observation }[];

  const w2l = runGraph(
    kernel,
    "pg-w2l",
    { trace: { slots }, traces: [{ slots }], identity },
    appliers,
    emitter,
  );
  const episodes = (w2l.get("episode")?.episodes ?? []) as Episode[];
  const triples = (w2l.get("semantic")?.triples ?? []) as Triple[];

  const audit = runGraph(
    kernel,
    "pg-audit",
    { artifact: { graph: "pg-w2l" }, policy: kernel.auditPolicy },
    appliers,
    emitter,
  );
  const auditOut = audit.get("report")?.audit as { flags: number } | undefined;

  const trace = makeTraceFile(kernel.spec, emitter.events);
  return {
    notes: files,
    episodes,
    triples,
    auditFlags: auditOut?.flags ?? 0,
    trace,
    checks: {
      validTrace: validTrace(kernel, trace.events),
      scheduleNonempty: scheduleNonempty(trace.events),
      commitAfterPermit: commitAfterPermit(trace.events),
      denyImpliesInterrupt: denyImpliesInterrupt(trace.events),
      auditNotEffect: auditNotEffect(trace.events),
    },
    permitPairs: permitPairing(trace.events),
    counts: eventHistogram(trace.events),
  };
}

export function writeTrace(report: TrayReport, outFile: string): void {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(report.trace, null, 2) + "\n");
}

function main(): void {
  const args = process.argv.slice(2);
  let inbox = join(HELIX_ROOT, "fixtures", "tray");
  let out = join(HELIX_ROOT, "traces", "tray.json");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--inbox" && args[i + 1]) inbox = resolve(args[++i] as string);
    else if (args[i] === "--out" && args[i + 1]) out = resolve(args[++i] as string);
    else throw new Error(`unknown argument: ${args[i]}`);
  }

  const report = runTray(inbox);
  writeTrace(report, out);

  const ev = report.trace.events;
  const twinInstalls = countType(ev, "twin.install");
  const stewardAcks = countType(ev, "steward.ack");
  const capMints = countType(ev, "cap.mint");
  const twinActions = countType(ev, "twin.action");
  const writes = ev.filter((e) => e.type === "store.write");
  const auditWrites = writes.filter((w) => w.type === "store.write" && w.store === "audit.inbox");

  console.log(`tray: ${report.notes.length} notes from ${inbox}`);
  for (const ep of report.episodes) {
    const t = report.triples.filter((x) => x.s === ep.note).length;
    console.log(`  - ${ep.note}: "${ep.title}" → ${t} triples`);
  }
  console.log(`audit: pg-w2l prompt corpus, ${report.auditFlags} heuristic flags → steward inbox`);
  console.log(`trace: ${out} (mneme.trace/v1)`);
  console.log(`event count: ${ev.length}`);
  console.log(`event histogram: ${JSON.stringify(report.counts)}`);
  console.log("checks (untrusted TS mirrors of Mneme.Trace; Lean is the artifact, ADR-008):");
  console.log(`  valid-trace (all nodes/edges named exist in kernel): ${report.checks.validTrace ? "PASS" : "FAIL"}`);
  console.log(`  schedule-nonempty: ${report.checks.scheduleNonempty ? "PASS" : "FAIL"}`);
  console.log(`  commit-after-permit: ${report.checks.commitAfterPermit ? "PASS" : "FAIL"}`);
  for (const p of report.permitPairs) {
    console.log(`    store.write[${p.writeIndex}] ${p.store} ← core.permit[${p.permitIndex}]`);
  }
  console.log(`    store.write total: ${writes.length} (${auditWrites.length} audit.inbox, permit-exempt)`);
  console.log(`  deny-implies-interrupt: ${report.checks.denyImpliesInterrupt ? "PASS" : "FAIL"} (${countType(ev, "core.deny")} denies)`);
  console.log(`  audit-not-effect: ${report.checks.auditNotEffect ? "PASS" : "FAIL"}`);
  console.log(`  twin.install events: ${twinInstalls} (${twinInstalls === 0 ? "absent" : "VIOLATION"})`);
  console.log(`  steward.ack events: ${stewardAcks} (${stewardAcks === 0 ? "absent" : "VIOLATION"})`);
  console.log(`  cap.mint events: ${capMints} (${capMints === 0 ? "absent" : "VIOLATION"})`);
  console.log(`  twin.action events: ${twinActions} (${twinActions === 0 ? "absent" : "VIOLATION"})`);

  const ok =
    Object.values(report.checks).every(Boolean) &&
    twinInstalls === 0 &&
    stewardAcks === 0 &&
    capMints === 0 &&
    twinActions === 0;
  if (!ok) {
    console.error("tray: checks FAILED");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
