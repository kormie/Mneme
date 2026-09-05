/**
 * Desk-tray dogfood (ADR-013 slice). A local-only CLI with two ingest
 * sources and one write path: the operator drops markdown notes into an
 * inbox directory (`--inbox`), or drains the L0 sensory buffer the
 * adapter listener fills (`--buffer`, jsonl of Observation packets).
 * Either way the scheduler runs the declared kernel graphs, commits
 * episodes and triples to a small local JSON store — one core.permit per
 * store.write — and emits a mneme.trace/v1 file. `--ask` runs the
 * declared pg-w2l read path over the store instead.
 *
 * Everything here is offline and deterministic. Prompt nodes run local
 * stand-in appliers — no model, no network. Frozen-surface transforms
 * (structural, audit-heuristics, sample-clean) get minimal stand-ins whose
 * real definitions are steward-held; they are marked below and must not be
 * mistaken for canon. The Core is a steward-owned file (src/core.ts,
 * default ~/.mneme/core.json, `--core` relocates) this CLI loads and
 * never writes. Its `values` are a closed enum: the stand-in ValueFilter
 * implements exactly one predicate ("human-utterance-only") and throws on
 * anything else rather than pretending to interpret a clause it cannot
 * honour. An empty Core constrains nothing — every commit passes, one
 * core.permit per store.write, exactly as before a constitution existed.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { defaultBufferFile } from "./buffer-path.js";
import {
  coreSnapshot,
  defaultCoreFile,
  loadCore,
  type CoreFile,
} from "./core.js";
import { judge, type Judgement } from "./judge.js";
import { loadKernel, type KernelIR } from "./kernel.js";
import { makeEmitter, runGraph, type Appliers, type Emitter } from "./scheduler.js";
import { type AnomalyFlag, type AnomalyMatch } from "./anomaly.js";
import { parseObservation, type Observation } from "./observation.js";
import { sensoryAppliers, type SensedObs } from "./sensory.js";
import { temporalQuery, type ObservationInterval } from "./temporal-query.js";
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
  observationTimeMs?: number;
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
  "wrote", "written", "say", "said", "happened", "last", "week",
]);

function queryTokens(text: string): string[] {
  return tokens(text).filter((t) => !STOPWORDS.has(t));
}

/** Store files are user-visible JSON and legacy/malformed fields must not
 * become invented dates. Only values representable by JavaScript's Date are
 * observation times; everything else remains unknown. */
function validObservationTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) &&
      Number.isFinite(new Date(value).getTime())
    ? value
    : undefined;
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

/** The one steward-named Core value this slice implements. The closed
 * enum is exactly this list; the ValueFilter stand-in throws on anything
 * else (fail closed), and no predicate is added here without Kormie. */
const IMPLEMENTED_VALUES = ["human-utterance-only"] as const;

/** The provenance kinds "human-utterance-only" admits: things the human
 * actually typed or dropped, discriminated on the declared kind field
 * only — never on packet text, never inferred from the channel. That
 * declaration is adapter-attested, not verified: the hook is the trust
 * anchor, and both kind and observation time ride through prompt-owned triples
 * that today's deterministic stand-ins copy honestly. A sealed
 * provenance sidecar (0.11, steward-decided) will carry them outside
 * prompt-owned data before any model-backed semantic node ships. */
const HUMAN_UTTERANCE_KINDS = ["note", "user-prompt"] as const;

/**
 * The provenance kind a commit proposal declares: the `kind` field on an
 * episodic Episode, or the `kind` triple on a semantic write. Undefined
 * means unknown — an entry from before kind was threaded through the
 * store — which fails closed under a provenance clause and passes under
 * an empty Core.
 */
function proposalKind(p: { store: string; value: Episode | Triple[] }): string | undefined {
  if (p.store === "episodic") return (p.value as Episode).kind;
  return (p.value as Triple[]).find((t) => t.p === "kind")?.o;
}

/**
 * Build the tray appliers. Effects (store.read/write, core.permit) are
 * emitted by appliers through ctx; routing stays the scheduler's alone.
 * `store` is the local memory the commit node persists into; `core` is
 * the loaded steward-owned Core file (read-only here — nothing in the
 * tray ever writes it, and its prose never leaves it). `core` is
 * deliberately required, here and on every exported entry point below:
 * a caller that could omit it would silently drain with no
 * constitution, the exact failure loadCore exists to refuse. Exported
 * so the tests can run a single pg-core invocation against the
 * stand-ins.
 */
export function trayAppliers(
  kernel: KernelIR,
  emitter: Emitter,
  store: TrayStore,
  core: CoreFile,
): Appliers {
  const coreStore = coreSnapshot(core);

  const appliers: Appliers = {
    // --- pg-s2w: Observation packets → working-memory slots (shared
    // with the adapter listener; see src/sensory.ts) -------------------
    ...sensoryAppliers(),

    // --- pg-w2l write path: slots → LTM commits -----------------------
    "pg-w2l/episode": (inputs) => {
      const trace = inputs.trace as { slots: { obs: SensedObs }[] };
      // Working episodes carry the note text for semantic extraction;
      // the persisted Episode never does (conflict rebuilds it from
      // triples, so only tokens reach the store).
      const episodes = trace.slots.map(({ obs }) => ({
        id: `ep:${obs.id}`,
        note: obs.id,
        title: obs.title,
        headings: obs.headings,
        channel: obs.channel,
        kind: obs.kind,
        observationTimeMs: obs.t,
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
        { s: ep.note, p: "channel", o: ep.channel ?? "file" },
        // The kind triple mirrors the channel triple, but never defaults:
        // a missing kind stays missing (unknown), because inventing one
        // would let a provenance clause pass on made-up provenance.
        ...(ep.kind === undefined ? [] : [{ s: ep.note, p: "kind", o: ep.kind }]),
        ...(ep.observationTimeMs === undefined
          ? []
          : [{ s: ep.note, p: "observation-time-ms", o: String(ep.observationTimeMs) }]),
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
        const kind = ts.find((t) => t.p === "kind")?.o;
        const observationTimeText = ts.find((t) => t.p === "observation-time-ms")?.o;
        const observationTimeMs = observationTimeText === undefined ||
            !/^-?\d+$/.test(observationTimeText)
          ? undefined
          : Number(observationTimeText);
        const normalizedObservationTimeMs = validObservationTime(observationTimeMs);
        const episode: Episode = {
          id: `ep:${note}`,
          note,
          title: ts.find((t) => t.p === "titled")?.o ?? note,
          headings: ts.filter((t) => t.p === "heading").map((t) => t.o),
          channel: ts.find((t) => t.p === "channel")?.o ?? "file",
          // No kind triple, no kind field: unknown stays unknown.
          ...(kind === undefined ? {} : { kind }),
          ...(normalizedObservationTimeMs === undefined
            ? {}
            : { observationTimeMs: normalizedObservationTimeMs }),
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
        if (item.store === "episodic") {
          Object.defineProperty(store.episodic, item.key, {
            value: item.value as Episode,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } else {
          Object.defineProperty(store.semantic, item.key, {
            value: item.value as Triple[],
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        written += 1;
      }
      return { ack: { rehearse: false, written } };
    },

    // --- pg-w2l read path: question → hits over the local store ------
    "pg-w2l/query": (inputs) => {
      const slots = inputs.slots as { text: string; asOf?: string }[];
      const text = slots.map((s) => s.text).join(" ");
      return {
        query: {
          tokens: queryTokens(text),
          temporal: temporalQuery(text, slots[0]?.asOf),
          indexes: ["episodic", "semantic"],
        },
      };
    },
    "pg-w2l/hybrid": (inputs, ctx) => {
      const query = inputs.query as { tokens: string[]; temporal: { interval?: ObservationInterval } };
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
          const observationTimeMs = validObservationTime(ep.observationTimeMs);
          return {
            note: ep.note,
            title: ep.title,
            score: matched.length,
            matched,
            triples: ts,
            ...(observationTimeMs === undefined ? {} : { observationTimeMs }),
          };
        })
        .filter((h) => {
          const interval = query.temporal.interval;
          if (interval !== undefined) {
            if (h.observationTimeMs === undefined) return false;
            if (h.observationTimeMs < interval.startMs || h.observationTimeMs >= interval.endMs) return false;
          }
          return query.tokens.length === 0 ? interval !== undefined : h.score > 0;
        })
        .sort((a, b) =>
          b.score - a.score ||
          (query.temporal.interval === undefined
            ? 0
            : (b.observationTimeMs ?? 0) - (a.observationTimeMs ?? 0)) ||
          (a.note < b.note ? -1 : a.note > b.note ? 1 : 0)
        );
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
    // Offline stand-in over the closed enum of steward-named values.
    // An empty constitution constrains nothing, so the proposal passes.
    // "human-utterance-only" refuses any commit whose proposal kind is
    // not a human utterance — defence in depth at Core, on top of the
    // salience gate that already keeps session chrome out of slots. Any
    // value this stand-in does not implement throws (fail closed): it
    // never pretends to interpret a clause it cannot honour, and it
    // never reads packet text to decide.
    "pg-core/value-filter": (inputs, ctx) => {
      const snapshot = inputs.snapshot as { values: string[] };
      const proposal = inputs.proposal as { store: string; value: Episode | Triple[] };
      const unknown = snapshot.values.filter(
        (v) => !(IMPLEMENTED_VALUES as readonly string[]).includes(v),
      );
      if (unknown.length > 0) {
        throw new Error(
          `tray value-filter stand-in cannot interpret core value(s): ${unknown.join(", ")}`,
        );
      }
      if (snapshot.values.includes("human-utterance-only")) {
        const kind = proposalKind(proposal);
        if (kind === undefined || !(HUMAN_UTTERANCE_KINDS as readonly string[]).includes(kind)) {
          // Rejected: no permit. The verdict routes on declared edge c5
          // to InterruptEmit, which emits core.deny + core.interrupt.
          return { verdict: { kind: "reject", cited_clauses: ["human-utterance-only"] } };
        }
      }
      ctx.emit({ type: "core.permit" });
      return { verdict: { kind: "pass", cited_clauses: [...snapshot.values] } };
    },
    // Scheduler signal surface (brief §9): deny must be immediately
    // followed by interrupt, so this node emits the pair adjacently.
    // Reached via declared edge c5 when the ValueFilter rejects a
    // proposal (c7, a refused twin permit, stays unreachable — no twins
    // in this slice). The interrupt diverts that one pg-core run; the
    // drain's other items continue, each under its own pg-core pass.
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
   * authorizes exactly one write (ADR-014), never amortized. A reject
   * routes to InterruptEmit inside this same invocation (core.deny +
   * core.interrupt) and the item is simply not written; the deny is
   * per item, never a halt of the whole drain. A denied note loses both
   * its items — episodic and semantic carry the same declared kind.
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
    // A pg-core run that produced no verdict is not a deny — it is a
    // broken invocation, and pretending otherwise would freeze writes
    // while reporting them as constitutionally refused. Fail loud.
    if (verdict === undefined) {
      throw new Error("pg-core produced no ValueFilter verdict for a write proposal");
    }
    return verdict.kind;
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
  /** Notes that reached the write path but whose commits Core refused
   * (core.deny + core.interrupt, both items — this drain wrote nothing
   * for them; an entry an earlier drain committed, if any, remains
   * until re-ingested or deleted). */
  denied: string[];
  episodes: Episode[];
  /** Everything the semantic node extracted this drain — the worked
   * candidates, denied notes' triples included. What persisted is what
   * the trace's store.write keys name, nothing more. */
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

/**
 * Scan an inbox directory for the `file` channel: every markdown note,
 * one packet each. A missing directory or an empty one is an ordinary
 * state here (no packets), not an error — explicit `--inbox` mode layers
 * its own error on top via readInbox.
 */
export function scanInbox(inboxDir: string): Observation[] {
  let files: string[];
  try {
    files = readdirSync(inboxDir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
  return files.map((f) => ({
    id: basename(f),
    t: Math.floor(statSync(join(inboxDir, f)).mtimeMs),
    channel: "file",
    kind: "note",
    text: readFileSync(join(inboxDir, f), "utf8"),
  }));
}

/** The `file` channel: every markdown note in the inbox, one packet each. */
export function readInbox(inboxDir: string): Observation[] {
  const packets = scanInbox(inboxDir);
  if (packets.length === 0) throw new Error(`no .md notes in inbox: ${inboxDir}`);
  return packets;
}

/**
 * Read the L0 sensory buffer the listener fills (ADAPTER.md): one
 * Observation packet per line. Delivery is at-least-once, so a
 * re-delivered id replaces the earlier line rather than becoming a
 * second packet. Non-packet lines are counted and skipped — one bad
 * line must not block the drain. The file itself is never consumed or
 * truncated here: memory is keyed, so re-draining replaces instead of
 * duplicating, and the operator rotates the buffer on their own terms.
 */
export function readBuffer(
  bufferFile: string,
): { packets: Observation[]; skipped: number } {
  const scan = scanBufferText(readFileSync(bufferFile, "utf8"));
  if (scan.packets.length === 0) {
    throw new Error(`no Observation packets in buffer: ${bufferFile}`);
  }
  return scan;
}

function scanBufferText(text: string): { packets: Observation[]; skipped: number } {
  const byId = new Map<string, Observation>();
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const packet = parseObservation(line);
    if (packet === null) skipped += 1;
    else byId.set(packet.id, packet);
  }
  return { packets: [...byId.values()], skipped };
}

export type DogfoodSource =
  | { kind: "buffer"; packets: Observation[]; skipped: number }
  | { kind: "inbox"; packets: Observation[] }
  | { kind: "nothing"; skipped: number };

/**
 * Resolve the dogfood ingest source (DOGFOOD.md): the L0 sensory buffer
 * when it holds packets, else the documented inbox default, else
 * nothing. Unlike the explicit --buffer/--inbox modes, an absent or
 * empty source is an ordinary Monday, not an error: the caller prints
 * "nothing to drain" and invents no write.
 */
export function dogfoodSource(bufferFile: string, inboxDir: string): DogfoodSource {
  let text: string | null;
  try {
    text = readFileSync(bufferFile, "utf8");
  } catch {
    text = null;
  }
  const scan = text === null ? { packets: [], skipped: 0 } : scanBufferText(text);
  if (scan.packets.length > 0) return { kind: "buffer", ...scan };
  const notes = scanInbox(inboxDir);
  if (notes.length > 0) return { kind: "inbox", packets: notes };
  return { kind: "nothing", skipped: scan.skipped };
}

/**
 * Drain one batch of Observation packets into long-term memory: pg-s2w
 * (anomaly gate included) → pg-w2l (one core.permit per store.write) →
 * pg-audit. Both ingest sources — the markdown inbox and the sensory
 * buffer — end up here, so there is exactly one write path.
 */
export function drainPackets(
  raw: Observation[],
  storeFile: string,
  core: CoreFile,
  kernel: KernelIR = loadKernel(),
  maxSlots = 64,
): TrayReport {
  const store = loadStore(storeFile);
  const emitter = makeEmitter();
  const appliers = trayAppliers(kernel, emitter, store, core);
  const identity = coreSnapshot(core);

  const s2w = runGraph(
    kernel,
    "pg-s2w",
    { raw, identity, slot_schema: { maxSlots } },
    appliers,
    emitter,
  );
  const slots = s2w.get("bind")?.slots as { obs: SensedObs }[];
  const deferred = (s2w.get("bind")?.dropped ?? []) as string[];
  const flag = s2w.get("anomaly")?.flag as AnomalyFlag | null;

  const w2l = runGraph(
    kernel,
    "pg-w2l",
    { trace: { slots }, traces: [{ slots }], identity },
    appliers,
    emitter,
  );
  const worked = (w2l.get("episode")?.episodes ?? []) as Episode[];
  const triples = (w2l.get("semantic")?.triples ?? []) as Triple[];
  // What actually persisted is what the trace's episodic writes name;
  // a note Core denied worked through the graph but was never written.
  const written = new Set(
    emitter.events
      .filter((e) => e.type === "store.write" && e.store === "episodic")
      .flatMap((e) => (e.type === "store.write" ? e.keys : [])),
  );
  const episodes = worked.filter((e) => written.has(e.id));
  const denied = worked.filter((e) => !written.has(e.id)).map((e) => e.note);

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
    notes: raw.map((p) => p.id),
    quarantined: flag?.matches ?? [],
    deferred,
    committed: episodes.map((e) => e.note),
    denied,
    episodes,
    triples,
    auditFlags: auditOut?.flags ?? 0,
    trace,
    checks: runChecks(kernel, trace),
    permitPairs: permitPairing(trace.events),
    counts: eventHistogram(trace.events),
  };
}

export function runTray(
  inboxDir: string,
  storeFile: string,
  core: CoreFile,
  kernel: KernelIR = loadKernel(),
  maxSlots = 64,
): TrayReport {
  return drainPackets(readInbox(inboxDir), storeFile, core, kernel, maxSlots);
}

export interface AskReport {
  question: string;
  hits: Hit[];
  storeNotes: number;
  trace: TraceFile;
  checks: Checks;
  observationInterval?: ObservationInterval;
  undatedExcluded: number;
}

export function runAsk(
  question: string,
  storeFile: string,
  core: CoreFile,
  kernel: KernelIR = loadKernel(),
  asOf?: string,
): AskReport {
  const store = loadStore(storeFile);
  const episodic = Object.keys(store.episodic).sort().map((k) => store.episodic[k]!);
  const semantic = Object.keys(store.semantic).sort().flatMap((k) => store.semantic[k]!);

  const emitter = makeEmitter();
  const appliers = trayAppliers(kernel, emitter, store, core);
  const out = runGraph(
    kernel,
    "pg-w2l",
    {
      slots: [{ id: "slot:ask", text: question, ...(asOf === undefined ? {} : { asOf }) }],
      identity: coreSnapshot(core),
      episodic,
      semantic,
      skills: [],
      structural: [],
    },
    appliers,
    emitter,
  );
  const injected = out.get("inject")?.slots as { items: Hit[] } | undefined;
  const query = out.get("query")?.query as { temporal?: { interval?: ObservationInterval } } | undefined;
  const observationInterval = query?.temporal?.interval;

  const trace = makeTraceFile(kernel.spec, emitter.events);
  return {
    question,
    hits: injected?.items ?? [],
    storeNotes: episodic.length,
    trace,
    checks: runChecks(kernel, trace),
    ...(observationInterval === undefined ? {} : { observationInterval }),
    undatedExcluded: observationInterval === undefined
      ? 0
      : episodic.filter((ep) => validObservationTime(ep.observationTimeMs) === undefined).length,
  };
}

export function writeTrace(trace: TraceFile, outFile: string): void {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(trace, null, 2) + "\n");
}

function checksOk(checks: Checks): boolean {
  return Object.values(checks).every(Boolean);
}

/**
 * Print the drain digest shared by every write mode (--inbox, --buffer,
 * --dogfood): what was quarantined, deferred, and committed, then the
 * slice-local untrusted checks over the emitted trace. Returns whether
 * everything a drain must uphold held.
 */
function printDrainDigest(
  report: TrayReport,
  sourceLine: string,
  storeFile: string,
  outFile: string,
): boolean {
  const ev = report.trace.events;
  const twinInstalls = countType(ev, "twin.install");
  const stewardAcks = countType(ev, "steward.ack");
  const capMints = countType(ev, "cap.mint");
  const twinActions = countType(ev, "twin.action");
  const writes = ev.filter((e) => e.type === "store.write");
  const auditWrites = writes.filter((w) => w.type === "store.write" && w.store === "audit.inbox");

  console.log(sourceLine);
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
  if (report.denied.length > 0) {
    console.log(
      "denied by Core (this drain wrote nothing for these; a previously committed version, if any, is still remembered):",
    );
    for (const n of report.denied) console.log(`  x ${n}`);
  }
  console.log("committed:");
  for (const ep of report.episodes) {
    const t = report.triples.filter((x) => x.s === ep.note).length;
    console.log(`  - ${ep.note} [${ep.channel ?? "file"}]: "${ep.title}" → ${t} triples`);
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

  return (
    checksOk(report.checks) &&
    twinInstalls === 0 &&
    stewardAcks === 0 &&
    capMints === 0 &&
    twinActions === 0
  );
}

/** The two Temporal liveness laws a tray trace can never satisfy honestly. */
function livenessRows(j: Judgement): { id: string; lean: string; status: string }[] {
  return j.rows.filter((r) => r.liveness).map((r) => ({ id: r.id, lean: r.lean, status: r.status }));
}

/**
 * The Monday-afternoon operator command (DOGFOOD.md): resolve the source
 * (buffer, else inbox), drain it through the one permit-gated write
 * path, judge the emitted trace with the untrusted judge, and print the
 * three dogfood prompts. Returns the process exit code: 0 when the
 * drain's checks and the judge's safety laws hold (the two liveness
 * gaps must stay red — a green one means a stuffed trace); 1 otherwise.
 */
function runDogfood(
  bufferFile: string,
  inboxDir: string,
  storeFile: string,
  outFile: string,
  core: CoreFile,
  coreLine: string,
): number {
  const src = dogfoodSource(bufferFile, inboxDir);
  console.log(coreLine);
  if (src.kind === "nothing") {
    console.log("dogfood: nothing to drain");
    console.log(`  buffer ${bufferFile}: absent or no packets` +
      (src.skipped > 0 ? ` (${src.skipped} non-packet line(s) ignored)` : ""));
    console.log(`  inbox ${inboxDir}: absent or no .md notes`);
    console.log("nothing was written: no store.write, no trace, no invented memory");
    return 0;
  }

  const kernel = loadKernel();
  const report = drainPackets(src.packets, storeFile, core, kernel);
  writeTrace(report.trace, outFile);
  const sourceLine = src.kind === "buffer"
    ? `dogfood: ${report.notes.length} packet(s) from buffer ${bufferFile}` +
      (src.skipped > 0 ? ` (${src.skipped} non-packet line(s) skipped)` : "")
    : `dogfood: ${report.notes.length} note(s) from inbox ${inboxDir} (buffer empty)`;
  const drainOk = printDrainDigest(report, sourceLine, storeFile, outFile);

  console.log("");
  const j = judge(kernel, report.trace.events);
  const safetyPass = j.judged;
  const liveness = livenessRows(j);
  const livenessStillRed = liveness.every((r) => r.status === "fail");
  console.log("judge (untrusted TS fold over spec/inhabitants.md, ADR-008) on this trace:");
  console.log(`  decidable: pass=${j.decidable.pass} fail=${j.decidable.fail} | temporal: pass=${j.temporal.pass} fail=${j.temporal.fail} skip=${j.temporal.skip}`);
  console.log(
    `  safety: ${safetyPass ? "PASS" : "FAIL"}` +
      (j.traceSafetyFails.length > 0 ? ` (${j.traceSafetyFails.join(", ")})` : ""),
  );
  console.log("  liveness gaps (must stay fail — this slice never runs pg-adl/pg-dem and stuffs no events):");
  for (const r of liveness) {
    console.log(
      `    ${r.id} — ${r.lean}: ${r.status}` +
        (r.status === "fail"
          ? " (correct; blocks RuntimeCertificate only)"
          : " — UNEXPECTED: a satisfied liveness law here means stuffed events; stop and ask Kormie"),
    );
  }
  console.log("  judged is not certified: the Lean terms in proofs/ are the artifacts, and this trace is not a RuntimeCertificate candidate.");

  console.log("");
  console.log("dogfood prompts — send answers (or a screenshot of this run) to Kormie (@kormie):");
  console.log("  1. Useful? Did the per-note digest and the trace tell you anything about");
  console.log("     your own notes that a folder listing would not have?");
  console.log("  2. Creepy? Was there any moment the tray felt like it overstepped — read too");
  console.log("     much, inferred too much, or kept something you did not expect it to keep?");
  if (core.values.length === 0) {
    console.log("  3. Missing Core clause? The constitution is empty, so every commit passed.");
    console.log("     What is the first clause you wished had been there to stop or reshape a");
    console.log("     write? Phrase it in your own words; the steward, not an agent, decides");
    console.log("     what enters Core.");
  } else {
    console.log(`  3. Missing Core clause? Your constitution holds: ${core.values.join(", ")}.`);
    console.log("     What is the next clause you wished had been there to stop or reshape a");
    console.log("     write? Phrase it in your own words; the steward, not an agent, decides");
    console.log("     what enters Core.");
  }

  if (!drainOk || !safetyPass || !livenessStillRed) {
    console.error("dogfood: checks FAILED");
    return 1;
  }
  return 0;
}

function main(): void {
  // Developers pipe CLI output through head/grep; a closed pipe is not an
  // error worth a stack trace.
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(0);
    throw e;
  });
  const args = process.argv.slice(2);
  let inbox: string | null = null;
  let buffer: string | null = null;
  let out: string | null = null;
  let storeFile = join(HELIX_ROOT, "store", "tray.json");
  let ask: string | null = null;
  let coreArg: string | null = null;
  let asOf: string | null = null;
  let dogfood = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i] as string;
    if (flag === "--dogfood") {
      dogfood = true;
    } else if (
      flag === "--inbox" || flag === "--buffer" || flag === "--out" ||
      flag === "--store" || flag === "--ask" || flag === "--core" || flag === "--as-of"
    ) {
      const value = args[++i];
      if (value === undefined) throw new Error(`missing value for ${flag}`);
      if (flag === "--inbox") inbox = resolve(value);
      else if (flag === "--buffer") buffer = resolve(value);
      else if (flag === "--out") out = resolve(value);
      else if (flag === "--store") storeFile = resolve(value);
      else if (flag === "--core") coreArg = resolve(value);
      else if (flag === "--as-of") asOf = value;
      else ask = value;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }

  // The steward-owned Core file loads before any drain runs: a malformed
  // constitution throws right here and nothing is written, rather than
  // loading as empty and silently constraining nothing (src/core.ts).
  const corePath = coreArg ?? defaultCoreFile();
  const core = loadCore(corePath);
  // The closed enum is checked at startup too, so a constitution this
  // slice cannot honour refuses every mode — including --ask and a
  // nothing-to-drain dogfood — not just the first write. The ValueFilter
  // keeps its own identical throw as defence in depth.
  const unknownValues = core.values.filter(
    (v) => !(IMPLEMENTED_VALUES as readonly string[]).includes(v),
  );
  if (unknownValues.length > 0) {
    throw new Error(
      `${corePath}: cannot interpret core value(s): ${unknownValues.join(", ")} ` +
        `(implemented: ${IMPLEMENTED_VALUES.join(", ")})`,
    );
  }
  const coreLine = core.values.length > 0
    ? `core: ${corePath} (values: ${core.values.join(", ")})`
    : `core: ${corePath} (empty — no constitution, every salient commit passes)`;

  if (dogfood) {
    if (ask !== null) throw new Error("choose one mode per run: --dogfood or --ask");
    if (asOf !== null) throw new Error("--as-of is only valid with --ask");
    // With --dogfood, --buffer and --inbox merely relocate the documented
    // defaults; source preference (buffer first) stays the same.
    process.exitCode = runDogfood(
      buffer ?? defaultBufferFile(join(homedir(), ".mneme")),
      inbox ?? join(homedir(), "mneme-tray"),
      storeFile,
      out ?? join(HELIX_ROOT, "traces", "dogfood.json"),
      core,
      coreLine,
    );
    return;
  }
  if (inbox !== null && buffer !== null) {
    throw new Error("choose one ingest source per run: --inbox or --buffer");
  }
  if (asOf !== null && ask === null) {
    throw new Error("--as-of is only valid with --ask");
  }

  if (ask !== null) {
    const report = runAsk(ask, storeFile, core, loadKernel(), asOf ?? undefined);
    const outFile = out ?? join(HELIX_ROOT, "traces", "ask.json");
    writeTrace(report.trace, outFile);
    console.log(`ask: "${report.question}" over ${report.storeNotes} remembered notes (${storeFile})`);
    if (report.observationInterval !== undefined) {
      console.log(
        `  observation time: [${report.observationInterval.start}, ${report.observationInterval.end}) ` +
        `(previous UTC calendar week; as-of ${asOf})`,
      );
      if (report.undatedExcluded > 0) {
        console.log(
          `  ${report.undatedExcluded} undated or unreadable record(s) in this store; ` +
          "time-bounded results cannot include them",
        );
      }
    }
    if (report.storeNotes === 0) {
      console.log("  no memory yet — drop notes in the inbox and run an ingest first");
    } else if (report.hits.length === 0) {
      console.log("  no matches");
    }
    for (const h of report.hits.slice(0, 5)) {
      const basis = h.matched.length > 0
        ? `score ${h.score}; matched ${h.matched.join(", ")}`
        : "observation time in interval";
      console.log(`  ${h.note} — "${h.title}" (${basis})`);
      if (h.observationTimeMs !== undefined) {
        const channel = h.triples.find((t) => t.p === "channel")?.o;
        const label = channel === "file" ? "observed (file mtime)" : "observed (adapter clock)";
        console.log(`      ${label}: ${new Date(h.observationTimeMs).toISOString()}`);
      }
      for (const t of h.triples.filter(
        (t) => t.p !== "mentions" && t.p !== "observation-time-ms",
      )) {
        console.log(`      (${t.s}, ${t.p}, ${t.o})`);
      }
      for (const t of h.triples.filter(
        (t) => t.p === "mentions" && h.matched.includes(fold(t.o)),
      )) {
        console.log(`      (${t.s}, ${t.p}, ${t.o})`);
      }
      if (h.matched.length === 0) {
        const keywords = h.triples.filter((t) => t.p === "mentions").map((t) => t.o);
        if (keywords.length > 0) {
          const preview = keywords.slice(0, 8).join(", ");
          const remainder = keywords.length > 8 ? ` … +${keywords.length - 8} more` : "";
          console.log(`      stored body keywords (not prose): ${preview}${remainder}`);
        }
      }
    }
    if (report.hits.length > 5) {
      console.log(`  … and ${report.hits.length - 5} more note(s) in this result`);
    }
    console.log(`trace: ${outFile} (mneme.trace/v1, ${report.trace.events.length} events; read-only — no store.write, no permit needed)`);
    console.log(`checks (untrusted TS mirrors, slice-local): ${checksOk(report.checks) ? "PASS" : "FAIL"}`);
    if (!checksOk(report.checks)) process.exitCode = 1;
    return;
  }

  let report: TrayReport;
  let sourceLine: string;
  if (buffer !== null) {
    const { packets, skipped } = readBuffer(buffer);
    report = drainPackets(packets, storeFile, core);
    sourceLine = `tray: ${report.notes.length} packet(s) from buffer ${buffer}` +
      (skipped > 0 ? ` (${skipped} non-packet line(s) skipped)` : "");
  } else {
    const inboxDir = inbox ?? join(HELIX_ROOT, "fixtures", "tray");
    let inboxStat;
    try {
      inboxStat = statSync(inboxDir);
    } catch {
      throw new Error(`inbox not found: ${inboxDir}`);
    }
    if (!inboxStat.isDirectory()) throw new Error(`inbox is not a directory: ${inboxDir}`);
    report = runTray(inboxDir, storeFile, core);
    sourceLine = `tray: ${report.notes.length} notes from ${inboxDir}`;
  }
  const outFile = out ?? join(HELIX_ROOT, "traces", "tray.json");
  writeTrace(report.trace, outFile);
  console.log(coreLine);
  if (!printDrainDigest(report, sourceLine, storeFile, outFile)) {
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
