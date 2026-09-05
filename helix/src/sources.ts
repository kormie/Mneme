/**
 * Read-only scans of the tray's ingest sources: the markdown inbox (the
 * `file` channel), the L0 sensory buffer the listener or the dogfood
 * sweep appends to, and the hook's spool. None of these consume, move,
 * or rewrite anything — drainSpool in listen.ts is the consuming sweep;
 * these are what the drain and `--status` read.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseObservation, type Observation } from "./observation.js";

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

/**
 * Parse buffer text: one Observation packet per line. Delivery is
 * at-least-once, so a re-delivered id replaces the earlier line (keeping
 * its first-seen position) rather than becoming a second packet.
 * Non-packet lines are counted and skipped — one bad line must not
 * block a drain.
 */
export function scanBufferText(text: string): { packets: Observation[]; skipped: number } {
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

/** The buffer file, or nothing at all when it does not exist yet. */
export function scanBufferFile(bufferFile: string): { packets: Observation[]; skipped: number } {
  let text: string;
  try {
    text = readFileSync(bufferFile, "utf8");
  } catch {
    return { packets: [], skipped: 0 };
  }
  return scanBufferText(text);
}

export interface SpoolScan {
  /** `*.json` files waiting for a sweep (parseable or not). */
  waiting: number;
  /** `*.json.bad` files a sweep sidelined as unparseable. */
  bad: number;
}

/** Count the spool without consuming it — never unlink, never rename. */
export function scanSpool(spoolDir: string): SpoolScan {
  let names: string[];
  try {
    names = readdirSync(spoolDir);
  } catch {
    return { waiting: 0, bad: 0 };
  }
  return {
    waiting: names.filter((f) => f.endsWith(".json")).length,
    bad: names.filter((f) => f.endsWith(".bad")).length,
  };
}
