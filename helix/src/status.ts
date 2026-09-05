/**
 * `--status`: is the loop alive? A pure inspection of the operator's
 * files — spool, buffer, inbox, store, the listener's socket path —
 * answering the morning questions "did the hook capture anything?",
 * "how much is waiting to be drained?", and "what does memory hold?".
 * It runs no graph, emits no trace, writes nothing, reads no clock, and
 * never prints packet text: counts and dates only.
 */
import { existsSync } from "node:fs";
import type { Observation } from "./observation.js";
import { loadStore } from "./store.js";
import { scanBufferFile, scanInbox, scanSpool, type SpoolScan } from "./sources.js";

export interface TrayStatus {
  spool: SpoolScan;
  buffer: {
    packets: number;
    skipped: number;
    byKind: Record<string, number>;
    /** Earliest and latest packet time, as ISO instants. */
    range?: { start: string; end: string };
    /** Buffer packets whose id is not yet an episode in the store, by
     * kind. This includes packets that never will be: session-stop
     * punctuation never commits by design, and a Core-denied packet is
     * refused again on every re-drain. */
    notRemembered: Record<string, number>;
  };
  inbox: {
    notes: number;
    /** Inbox notes with no episode in the store yet. A remembered note is
     * re-drained idempotently, so only these are new work. */
    notRemembered: number;
  };
  store: {
    episodes: number;
    byChannel: Record<string, number>;
    byKind: Record<string, number>;
    range?: { start: string; end: string };
    undated: number;
  };
  /** Whether a listener socket path exists (never probed). */
  socketPresent: boolean;
}

function histogram(keys: string[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const k of [...keys].sort()) h[k] = (h[k] ?? 0) + 1;
  return h;
}

function range(times: number[]): { start: string; end: string } | undefined {
  if (times.length === 0) return undefined;
  return {
    start: new Date(Math.min(...times)).toISOString(),
    end: new Date(Math.max(...times)).toISOString(),
  };
}

export function trayStatus(paths: {
  spoolDir: string;
  bufferFile: string;
  inboxDir: string;
  storeFile: string;
  sockPath: string;
}): TrayStatus {
  const spool = scanSpool(paths.spoolDir);
  const buffer = scanBufferFile(paths.bufferFile);
  const inbox = scanInbox(paths.inboxDir);
  const store = loadStore(paths.storeFile);
  const episodes = Object.values(store.episodic);
  const remembered = new Set(Object.keys(store.episodic));
  const notRemembered = buffer.packets.filter((p: Observation) => !remembered.has(`ep:${p.id}`));
  const dated = episodes
    .map((e) => e.observationTimeMs)
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  const bufferRange = range(buffer.packets.map((p) => p.t));
  const storeRange = range(dated);
  return {
    spool,
    buffer: {
      packets: buffer.packets.length,
      skipped: buffer.skipped,
      byKind: histogram(buffer.packets.map((p) => p.kind)),
      ...(bufferRange === undefined ? {} : { range: bufferRange }),
      notRemembered: histogram(notRemembered.map((p) => p.kind)),
    },
    inbox: {
      notes: inbox.length,
      notRemembered: inbox.filter((p: Observation) => !remembered.has(`ep:${p.id}`)).length,
    },
    store: {
      episodes: episodes.length,
      byChannel: histogram(episodes.map((e) => e.channel ?? "file")),
      byKind: histogram(episodes.map((e) => e.kind ?? "unknown")),
      ...(storeRange === undefined ? {} : { range: storeRange }),
      undated: episodes.length - dated.length,
    },
    socketPresent: existsSync(paths.sockPath),
  };
}

function counts(h: Record<string, number>): string {
  const parts = Object.entries(h).map(([k, n]) => `${k} ${n}`);
  return parts.length === 0 ? "none" : parts.join(", ");
}

export function printStatus(
  s: TrayStatus,
  paths: { spoolDir: string; bufferFile: string; inboxDir: string; storeFile: string; sockPath: string },
): void {
  console.log("status (inspection only: no graph ran, no trace written, nothing changed)");
  console.log(
    `  spool ${paths.spoolDir}: ${s.spool.waiting} packet file(s) waiting for a sweep` +
      (s.spool.bad > 0 ? `, ${s.spool.bad} sidelined as .bad` : ""),
  );
  console.log(
    `  buffer ${paths.bufferFile}: ${s.buffer.packets} packet(s)` +
      (s.buffer.skipped > 0 ? ` (${s.buffer.skipped} non-packet line(s))` : "") +
      ` — ${counts(s.buffer.byKind)}` +
      (s.buffer.range === undefined ? "" : `; observed ${s.buffer.range.start} to ${s.buffer.range.end}`),
  );
  const pending = Object.entries(s.buffer.notRemembered);
  if (pending.length > 0) {
    console.log(
      `    buffered, not remembered: ${counts(s.buffer.notRemembered)}` +
        " (includes session punctuation and Core denials, which never commit" +
        (s.buffer.notRemembered["session-stop"] === undefined
          ? ")"
          : "; session-stop is punctuation)"),
    );
  }
  console.log(
    `  inbox ${paths.inboxDir}: ${s.inbox.notes} markdown note(s)` +
      (s.inbox.notes > 0 ? `, ${s.inbox.notRemembered} not yet remembered` : ""),
  );
  console.log(
    `  memory ${paths.storeFile}: ${s.store.episodes} remembered — by channel ${counts(s.store.byChannel)}; by kind ${counts(s.store.byKind)}` +
      (s.store.range === undefined ? "" : `; observed ${s.store.range.start} to ${s.store.range.end}`) +
      (s.store.undated > 0 ? `; ${s.store.undated} undated` : ""),
  );
  console.log(`  listener socket ${paths.sockPath}: ${s.socketPresent ? "present (not probed)" : "absent — the hook spools, dogfood sweeps"}`);
  // Only the spool and the inbox are known to hold work a drain will
  // commit; an un-remembered buffer packet may be one the Core refuses
  // again, so it never turns into a standing "drain now".
  const unremembered = pending.reduce((n, [k, c]) => (k === "session-stop" ? n : n + c), 0);
  if (s.spool.waiting + s.inbox.notRemembered > 0) {
    console.log(
      `  next: bun run dogfood (${s.spool.waiting} spooled + ${s.inbox.notRemembered} new inbox note(s) to drain)`,
    );
  } else if (unremembered > 0) {
    console.log(
      `  next: nothing new is waiting; a re-drain commits any of the ${unremembered} un-remembered buffer packet(s) the Core admits (denials are refused again)`,
    );
  } else {
    console.log("  next: nothing waiting; bun run ask \"…\" to read memory");
  }
}
