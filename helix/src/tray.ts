/**
 * Desk-tray dogfood (ADR-013 slice). A local-only CLI: the operator drops
 * their own markdown notes into an inbox directory; the scheduler runs the
 * declared kernel graphs over them, commits episodes and triples to a
 * small local JSON store, and emits a mneme.trace/v1 file. `--ask` runs
 * the declared pg-w2l read path over the store instead.
 *
 * Everything here is offline and deterministic. Prompt nodes run local
 * stand-in appliers — no model, no network. Frozen-surface transforms
 * (structural, audit-heuristics, sample-clean) get minimal stand-ins whose
 * real definitions are steward-held; they are marked below and must not be
 * mistaken for canon. The Core store ships empty: the stand-in ValueFilter
 * refuses to interpret steward-authored clauses, so a non-empty
 * constitution needs a real ValueFilter first.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { loadKernel, type KernelIR } from "./kernel.js";
import { makeEmitter, runGraph, type Appliers, type Emitter } from "./scheduler.js";
import { scanNotes, type AnomalyFlag, type AnomalyMatch } from "./anomaly.js";
import {
  loadStore,
  saveStore,
  type Episode,
  type TrayStore,
  type Triple,
} from "./store.js";
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
  text: string;
}

interface WriteItem {
  store: "episodic" | "semantic";
  key: string;
  value: Episode | Triple[];
}

export interface Hit {
  note: string;
  title: string;
  score: number;
  matched: string[];
  triples: Triple[];
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

function firstLine(text: string): string | null {
  return text.split("\n").find((l) => l.trim() !== "")?.trim() ?? null;
}

/** Accent-folded (NFKD, marks stripped) so "réunion" matches "reunion". */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function tokens(text: string): string[] {
  return [...new Set(fold(text).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3))];
}

/** Question words carry no signal; drop them from queries, not haystacks. */
const STOPWORDS = new Set([
  "what", "when", "where", "which", "who", "whom", "why", "how", "did", "does",
  "do", "the", "and", "for", "with", "about", "was", "were", "are", "you",
  "your", "have", "has", "had", "this", "that", "note", "notes", "write",
  "wrote", "written", "say", "said", "last", "week",
]);

function queryTokens(text: string): string[] {
  return tokens(text).filter((t) => !STOPWORDS.has(t));
}

/**
 * The most frequent body words (folded, stopwords out, capped so a huge
 * note cannot flood the store). These become "mentions" triples — a bag
 * of words, deliberately not the prose itself.
 */
function bodyKeywords(text: string, cap = 64): string[] {
  const counts = new Map<string, number>();
  for (const t of fold(text).split(/[^\p{L}\p{N}]+/u)) {
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, cap)
    .map(([t]) => t);
}

/**
 * Build the tray appliers. Effects (store.read/write, core.permit) are
 * emitted by appliers through ctx; routing stays the scheduler's alone.
 * `store` is the local memory the commit node persists into.
 */
function trayAppliers(kernel: KernelIR, emitter: Emitter, store: TrayStore): Appliers {
  const coreStore = { values: [] as string[], goals: [] as string[], style: {} };

  const appliers: Appliers = {
    // --- pg-s2w: inbox files → working-memory slots -------------------
    "pg-s2w/sensor-normalize": (inputs, ctx) => {
      const raw = inputs.raw as RawPacket[];
      ctx.emit({ type: "store.read", store: "buffer", keys: raw.map((p) => p.id) });
      const obs: Observation[] = raw.map((p) => ({
        id: p.id,
        source: p.id,
        title: firstHeading(p.text) ?? firstLine(p.text) ?? p.id,
        headings: headings(p.text),
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
    // Offline stand-in: deterministic secret scan (src/anomaly.ts). A
    // non-null flag routes on declared edge e4 so the gate quarantines.
    "pg-s2w/anomaly": (inputs) => {
      const obs = inputs.obs as Observation[];
      return { flag: scanNotes(obs) };
    },
    "pg-s2w/gate": (inputs) => {
      const scored = inputs.scored as { obs: Observation; salience: number }[];
      const flag = inputs.flag as AnomalyFlag | undefined;
      const quarantined = new Set(flag?.notes ?? []);
      return { selected: scored.filter((s) => !quarantined.has(s.obs.id)).map((s) => s.obs) };
    },
    "pg-s2w/style": () => ({ style: { tone: "plain" } }),
    // Working memory is a declared budget (slot_schema.maxSlots); what
    // does not fit is reported on the dropped port, never lost silently.
    "pg-s2w/bind": (inputs) => {
      const selected = inputs.selected as Observation[];
      const schema = inputs.slot_schema as { maxSlots: number };
      return {
        slots: selected.slice(0, schema.maxSlots).map((o) => ({ id: `slot:${o.id}`, obs: o })),
        dropped: selected.slice(schema.maxSlots).map((o) => o.id),
      };
    },

    // --- pg-w2l write path: slots → LTM commits -----------------------
    "pg-w2l/episode": (inputs) => {
      const trace = inputs.trace as { slots: { obs: Observation }[] };
      // Working episodes carry the note text for semantic extraction;
      // the persisted Episode never does (conflict rebuilds it from
      // triples, so only tokens reach the store).
      const episodes = trace.slots.map(({ obs }) => ({
        id: `ep:${obs.id}`,
        note: obs.id,
        title: obs.title,
        headings: obs.headings,
        text: obs.text,
      }));
      return { episodes };
    },
    // Offline stand-in: keep everything; compression needs a model.
    "pg-w2l/rehearse": (inputs) => ({
      kept: inputs.episodes as Episode[],
      decision: "keep",
    }),
    // Offline stand-in: syntactic triples — title, headings, and a
    // capped bag of body keywords so ordinary prose is searchable.
    "pg-w2l/semantic": (inputs) => {
      const kept = inputs.kept as (Episode & { text?: string })[];
      const triples: Triple[] = kept.flatMap((ep) => [
        { s: ep.note, p: "titled", o: ep.title },
        ...ep.headings.map((h) => ({ s: ep.note, p: "heading", o: h })),
        ...bodyKeywords(ep.text ?? "").map((o) => ({ s: ep.note, p: "mentions", o })),
      ]);
      return { triples };
    },
    // Offline stand-in: personal notes yield no procedural skill graphs.
    "pg-w2l/skill": () => ({ skill: null }),
    // FROZEN surface (structural). Steward-held; this stand-in asserts
    // nothing: no structural claims from an offline heuristic.
    "pg-w2l/structural": () => ({ edges: [] }),
    // The WriteSet is built from conflict's declared inputs only: the
    // episodic candidates are reconstructed from the triples, so what
    // commit persists arrived through the graph, not a side channel.
    "pg-w2l/conflict": (inputs) => {
      const triples = inputs.triples as Triple[];
      const byNote = new Map<string, Triple[]>();
      for (const t of triples) byNote.set(t.s, [...(byNote.get(t.s) ?? []), t]);
      const items: WriteItem[] = [...byNote.keys()].sort().flatMap((note): WriteItem[] => {
        const ts = byNote.get(note)!;
        const episode: Episode = {
          id: `ep:${note}`,
          note,
          title: ts.find((t) => t.p === "titled")?.o ?? note,
          headings: ts.filter((t) => t.p === "heading").map((t) => t.o),
        };
        return [
          { store: "episodic", key: episode.id, value: episode },
          { store: "semantic", key: note, value: ts },
        ];
      });
      return { resolved: { items, contradictions: [] } };
    },
    "pg-w2l/align": (inputs) => ({
      verdict: { kind: "pass", clauses: [] },
      write: inputs.resolved,
    }),
    "pg-w2l/commit": (inputs, ctx) => {
      const write = inputs.write as { items: WriteItem[] };
      let written = 0;
      for (const item of write.items) {
        const verdict = requestPermit(item);
        if (verdict !== "pass") continue; // deny already flushed the permit
        ctx.emit({ type: "store.write", store: item.store, keys: [item.key] });
        if (item.store === "episodic") store.episodic[item.key] = item.value as Episode;
        else store.semantic[item.key] = item.value as Triple[];
        written += 1;
      }
      return { ack: { rehearse: false, written } };
    },

    // --- pg-w2l read path: question → hits over the local store ------
    "pg-w2l/query": (inputs) => {
      const slots = inputs.slots as { text: string }[];
      return { query: { tokens: queryTokens(slots.map((s) => s.text).join(" ")), indexes: ["episodic", "semantic"] } };
    },
    "pg-w2l/hybrid": (inputs, ctx) => {
      const query = inputs.query as { tokens: string[] };
      const episodic = inputs.episodic as Episode[];
      const semantic = inputs.semantic as Triple[];
      ctx.emit({ type: "store.read", store: "episodic", keys: episodic.map((e) => e.id) });
      ctx.emit({ type: "store.read", store: "semantic", keys: [...new Set(semantic.map((t) => t.s))] });
      const hits: Hit[] = episodic
        .map((ep) => {
          const ts = semantic.filter((t) => t.s === ep.note);
          const haystack = tokens(
            [ep.note, ep.title, ...ep.headings, ...ts.map((t) => t.o)].join(" "),
          );
          const matched = query.tokens.filter((q) => haystack.includes(q));
          return { note: ep.note, title: ep.title, score: matched.length, matched, triples: ts };
        })
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score || (a.note < b.note ? -1 : 1));
      return { hits };
    },
    // Offline stand-in: hybrid's order is already deterministic; a real
    // rerank is a Core-constrained prompt.
    "pg-w2l/rerank": (inputs) => ({ ranked: inputs.hits }),
    "pg-w2l/inject": (inputs) => ({
      slots: { need_more: false, items: inputs.ranked },
    }),

    // --- pg-core: one ValueFilter pass per commit item ----------------
    "pg-core/id-read": (inputs, ctx) => {
      const cs = inputs.core_store as typeof coreStore;
      ctx.emit({ type: "store.read", store: "values", keys: ["clauses"] });
      return { snapshot: { values: cs.values, goals: cs.goals, style: cs.style } };
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
    // Scheduler signal surface (brief §9): deny must be immediately
    // followed by interrupt, so this node emits the pair adjacently.
    // Reachable only via c5 (reject) or c7 (refused permit); the tray's
    // pass-only stand-in never routes here, but the wiring is real.
    "pg-core/interrupt": (_inputs, ctx) => {
      ctx.emit({ type: "core.deny" });
      ctx.emit({ type: "core.interrupt" });
      return { interrupt: { halted: true } };
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

  /**
   * Consult Core for one write item: a full pg-core invocation whose
   * ValueFilter emits core.permit on pass. One run per item — a permit
   * authorizes exactly one write (ADR-014), never amortized.
   */
  function requestPermit(item: WriteItem): string {
    const out = runGraph(
      kernel,
      "pg-core",
      // The full payload rides in the proposal so future steward clauses
      // can discriminate values, not just store/key labels.
      { core_store: coreStore, proposal: { store: item.store, key: item.key, value: item.value } },
      appliers,
      emitter,
    );
    const verdict = out.get("value-filter")?.verdict as { kind: string } | undefined;
    return verdict?.kind ?? "no-verdict";
  }

  return appliers;
}

export interface Checks {
  validTrace: boolean;
  scheduleNonempty: boolean;
  commitAfterPermit: boolean;
  denyImpliesInterrupt: boolean;
  auditNotEffect: boolean;
}

function runChecks(kernel: KernelIR, trace: TraceFile): Checks {
  return {
    validTrace: validTrace(kernel, trace.events),
    scheduleNonempty: scheduleNonempty(trace.events),
    commitAfterPermit: commitAfterPermit(trace.events),
    denyImpliesInterrupt: denyImpliesInterrupt(trace.events),
    auditNotEffect: auditNotEffect(trace.events),
  };
}

export interface TrayReport {
  notes: string[];
  quarantined: AnomalyMatch[];
  deferred: string[];
  committed: string[];
  episodes: Episode[];
  triples: Triple[];
  auditFlags: number;
  trace: TraceFile;
  checks: Checks;
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

export function runTray(
  inboxDir: string,
  storeFile: string,
  kernel: KernelIR = loadKernel(),
  maxSlots = 64,
): TrayReport {
  const files = readdirSync(inboxDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (files.length === 0) throw new Error(`no .md notes in inbox: ${inboxDir}`);
  const raw: RawPacket[] = files.map((f) => ({
    id: basename(f),
    channel: "file",
    text: readFileSync(join(inboxDir, f), "utf8"),
  }));

  const store = loadStore(storeFile);
  const emitter = makeEmitter();
  const appliers = trayAppliers(kernel, emitter, store);
  const identity = { values: [], goals: [], style: {} };

  const s2w = runGraph(
    kernel,
    "pg-s2w",
    { raw, identity, slot_schema: { maxSlots } },
    appliers,
    emitter,
  );
  const slots = s2w.get("bind")?.slots as { obs: Observation }[];
  const deferred = (s2w.get("bind")?.dropped ?? []) as string[];
  const flag = s2w.get("anomaly")?.flag as AnomalyFlag | null;

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

  saveStore(storeFile, store);

  const trace = makeTraceFile(kernel.spec, emitter.events);
  return {
    notes: files,
    quarantined: flag?.matches ?? [],
    deferred,
    committed: episodes.map((e) => e.note),
    episodes,
    triples,
    auditFlags: auditOut?.flags ?? 0,
    trace,
    checks: runChecks(kernel, trace),
    permitPairs: permitPairing(trace.events),
    counts: eventHistogram(trace.events),
  };
}

export interface AskReport {
  question: string;
  hits: Hit[];
  storeNotes: number;
  trace: TraceFile;
  checks: Checks;
}

export function runAsk(
  question: string,
  storeFile: string,
  kernel: KernelIR = loadKernel(),
): AskReport {
  const store = loadStore(storeFile);
  const episodic = Object.keys(store.episodic).sort().map((k) => store.episodic[k]!);
  const semantic = Object.keys(store.semantic).sort().flatMap((k) => store.semantic[k]!);

  const emitter = makeEmitter();
  const appliers = trayAppliers(kernel, emitter, store);
  const out = runGraph(
    kernel,
    "pg-w2l",
    {
      slots: [{ id: "slot:ask", text: question }],
      identity: { values: [], goals: [], style: {} },
      episodic,
      semantic,
      skills: [],
      structural: [],
    },
    appliers,
    emitter,
  );
  const injected = out.get("inject")?.slots as { items: Hit[] } | undefined;

  const trace = makeTraceFile(kernel.spec, emitter.events);
  return {
    question,
    hits: injected?.items ?? [],
    storeNotes: episodic.length,
    trace,
    checks: runChecks(kernel, trace),
  };
}

export function writeTrace(trace: TraceFile, outFile: string): void {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(trace, null, 2) + "\n");
}

function checksOk(checks: Checks): boolean {
  return Object.values(checks).every(Boolean);
}

function main(): void {
  // Developers pipe CLI output through head/grep; a closed pipe is not an
  // error worth a stack trace.
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(0);
    throw e;
  });
  const args = process.argv.slice(2);
  let inbox = join(HELIX_ROOT, "fixtures", "tray");
  let out: string | null = null;
  let storeFile = join(HELIX_ROOT, "store", "tray.json");
  let ask: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i] as string;
    if (flag === "--inbox" || flag === "--out" || flag === "--store" || flag === "--ask") {
      const value = args[++i];
      if (value === undefined) throw new Error(`missing value for ${flag}`);
      if (flag === "--inbox") inbox = resolve(value);
      else if (flag === "--out") out = resolve(value);
      else if (flag === "--store") storeFile = resolve(value);
      else ask = value;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }

  if (ask !== null) {
    const report = runAsk(ask, storeFile);
    const outFile = out ?? join(HELIX_ROOT, "traces", "ask.json");
    writeTrace(report.trace, outFile);
    console.log(`ask: "${report.question}" over ${report.storeNotes} remembered notes (${storeFile})`);
    if (report.storeNotes === 0) {
      console.log("  no memory yet — drop notes in the inbox and run an ingest first");
    } else if (report.hits.length === 0) {
      console.log("  no matches");
    }
    for (const h of report.hits.slice(0, 5)) {
      console.log(`  ${h.note} — "${h.title}" (score ${h.score}; matched ${h.matched.join(", ")})`);
      for (const t of h.triples.filter((t) => t.p !== "mentions")) {
        console.log(`      (${t.s}, ${t.p}, ${t.o})`);
      }
      const kw = h.triples.filter((t) => t.p === "mentions").length;
      if (kw > 0) console.log(`      + ${kw} body keywords indexed`);
    }
    console.log(`trace: ${outFile} (mneme.trace/v1, ${report.trace.events.length} events; read-only — no store.write, no permit needed)`);
    console.log(`checks (untrusted TS mirrors, slice-local): ${checksOk(report.checks) ? "PASS" : "FAIL"}`);
    if (!checksOk(report.checks)) process.exitCode = 1;
    return;
  }

  let inboxStat;
  try {
    inboxStat = statSync(inbox);
  } catch {
    throw new Error(`inbox not found: ${inbox}`);
  }
  if (!inboxStat.isDirectory()) throw new Error(`inbox is not a directory: ${inbox}`);

  const report = runTray(inbox, storeFile);
  const outFile = out ?? join(HELIX_ROOT, "traces", "tray.json");
  writeTrace(report.trace, outFile);

  const ev = report.trace.events;
  const twinInstalls = countType(ev, "twin.install");
  const stewardAcks = countType(ev, "steward.ack");
  const capMints = countType(ev, "cap.mint");
  const twinActions = countType(ev, "twin.action");
  const writes = ev.filter((e) => e.type === "store.write");
  const auditWrites = writes.filter((w) => w.type === "store.write" && w.store === "audit.inbox");

  console.log(`tray: ${report.notes.length} notes from ${inbox}`);
  if (report.quarantined.length > 0) {
    console.log(
      "quarantined (this version stayed out of memory; a previously committed clean version may still be remembered):",
    );
    for (const q of report.quarantined) console.log(`  ! ${q.note}: ${q.rule}`);
  } else {
    console.log("secret scan: no rules matched (a clean scan is not a guarantee)");
  }
  if (report.deferred.length > 0) {
    console.log(
      `deferred (working-memory budget reached — ingest these separately): ${report.deferred.join(", ")}`,
    );
  }
  console.log("committed:");
  for (const ep of report.episodes) {
    const t = report.triples.filter((x) => x.s === ep.note).length;
    console.log(`  - ${ep.note}: "${ep.title}" → ${t} triples`);
  }
  console.log(`memory: ${storeFile}`);
  console.log(`audit: pg-w2l prompt corpus, ${report.auditFlags} heuristic flags → steward inbox`);
  console.log(`trace: ${outFile} (mneme.trace/v1)`);
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
  console.log(
    "not claimed: full Mneme.Trace.Temporal also needs cluster.cut and archive.sample (ADL/DEM, out of this slice); this report is slice-local and the trace is not yet imported into Lean",
  );

  const ok =
    checksOk(report.checks) &&
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
  try {
    main();
  } catch (err) {
    // A daily tool reports its errors in one line, not a stack trace.
    console.error(`tray: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
