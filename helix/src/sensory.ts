/**
 * Shared pg-s2w appliers: adapter Observation packets (the RawPacket[]
 * on the graph's declared ingress `raw`) → bounded working-memory slots.
 * Used by both the tray CLI (file channel) and the adapter listener
 * (socket/spool channels), so every ingress path passes the same
 * salience/anomaly/gate/bind pipeline the kernel declares. Prompt nodes
 * run deterministic offline stand-ins — no model, no network — and the
 * anomaly stand-in is the secrets quarantine in src/anomaly.ts.
 */
import type { Appliers } from "./scheduler.js";
import { scanNotes, type AnomalyFlag } from "./anomaly.js";
import type { Observation } from "./observation.js";

/** A normalized observation inside pg-s2w: the packet plus derived
 * title/headings. This is the graph's internal `Observation` port type,
 * distinct from the wire packet in observation.ts. */
export interface SensedObs {
  id: string;
  channel: string;
  kind: string;
  t: number;
  title: string;
  headings: string[];
  text: string;
}

export function firstHeading(text: string): string | null {
  for (const line of text.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.*\S)/);
    if (m) return m[1] ?? null;
  }
  return null;
}

export function headings(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.match(/^#{2,6}\s+(.*\S)/)?.[1])
    .filter((h): h is string => h !== undefined);
}

export function firstLine(text: string): string | null {
  return text.split("\n").find((l) => l.trim() !== "")?.trim() ?? null;
}

export function sensoryAppliers(): Appliers {
  return {
    "pg-s2w/sensor-normalize": (inputs, ctx) => {
      const raw = inputs.raw as Observation[];
      ctx.emit({ type: "store.read", store: "buffer", keys: raw.map((p) => p.id) });
      const obs: SensedObs[] = raw.map((p) => ({
        id: p.id,
        channel: p.channel,
        kind: p.kind,
        t: p.t,
        title: firstHeading(p.text) ?? firstLine(p.text) ?? p.id,
        headings: headings(p.text),
        text: p.text,
      }));
      return { obs };
    },
    // Offline stand-in: no model call. Scores come from the packet's
    // declared `kind` field, never from its text: session punctuation
    // (`session-stop`) scores 0 — observed in L0, below every bind —
    // while notes and user prompts stay at 1.
    "pg-s2w/salience": (inputs) => {
      const obs = inputs.obs as SensedObs[];
      return {
        scored: obs.map((o) =>
          o.kind === "session-stop"
            ? { obs: o, salience: 0, rationale: "session punctuation (offline stand-in)" }
            : { obs: o, salience: 1, rationale: "offline stand-in" },
        ),
      };
    },
    // Offline stand-in: deterministic secret scan (src/anomaly.ts). A
    // non-null flag routes on declared edge e4 so the gate quarantines.
    "pg-s2w/anomaly": (inputs) => {
      const obs = inputs.obs as SensedObs[];
      return { flag: scanNotes(obs) };
    },
    // The AttentionGate's declared role is a deterministic threshold and
    // budget, so it honours the scored port: only observations with
    // positive salience pass, and quarantined ids never do. Salience 0
    // stays an L0 observation — buffered, never bound.
    "pg-s2w/gate": (inputs) => {
      const scored = inputs.scored as { obs: SensedObs; salience: number }[];
      const flag = inputs.flag as AnomalyFlag | undefined;
      const quarantined = new Set(flag?.notes ?? []);
      return {
        selected: scored
          .filter((s) => s.salience > 0 && !quarantined.has(s.obs.id))
          .map((s) => s.obs),
      };
    },
    "pg-s2w/style": () => ({ style: { tone: "plain" } }),
    // Working memory is a declared budget (slot_schema.maxSlots); what
    // does not fit is reported on the dropped port, never lost silently.
    "pg-s2w/bind": (inputs) => {
      const selected = inputs.selected as SensedObs[];
      const schema = inputs.slot_schema as { maxSlots: number };
      return {
        slots: selected.slice(0, schema.maxSlots).map((o) => ({ id: `slot:${o.id}`, obs: o })),
        dropped: selected.slice(schema.maxSlots).map((o) => o.id),
      };
    },
  };
}
