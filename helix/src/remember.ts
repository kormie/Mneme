#!/usr/bin/env bun
/**
 * `bun run remember "…"`: an agent (or the operator at a terminal)
 * records one observation on purpose — a pitfall found in the code, a
 * decision and its reason, a thing the next session should not have to
 * rediscover. It is a sensor with a hand on the button, and it has the
 * hook's boundaries: it pushes exactly the text it was given as one
 * Observation packet with declared provenance (`channel: claude-code`,
 * `kind: agent-note`), spools it like the hook does when no listener is
 * up, and stops. It never writes a store, never runs a graph, never
 * reads anything back. The packet enters memory only through the next
 * `bun run dogfood`: swept through pg-s2w (the secrets quarantine
 * included), then proposed to the operator's Core one write at a time.
 * A `human-utterance-only` Core refuses agent notes by design; an empty
 * Core admits them. Agents may author candidates; they never promote
 * them.
 *
 * The clock is read here, once, as the adapter's own observation time —
 * adapters observe when things happen; Helix's graphs never consult it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { resolveSpoolDir } from "./buffer-path.js";
import { isObservation, type Observation } from "./observation.js";

export const AGENT_NOTE_KIND = "agent-note";

/** A packet id is one path segment in the hook's alphabet: it names the
 * spool file, so it must never be able to leave the spool directory. */
export const PACKET_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/u;

export function assertPacketId(id: string): void {
  if (!PACKET_ID.test(id) || id !== basename(id) || id === "." || id === "..") {
    throw new Error(`--id must be a single path segment of [A-Za-z0-9._-], got ${JSON.stringify(id)}`);
  }
}

/** Build the packet. `t` is the observation time in Unix milliseconds;
 * `id` defaults to the hook's shape (`cc-<t>-<8 hex>`) with an `an-`
 * prefix so a spool listing shows what an agent wrote. */
export function agentNote(text: string, t: number, id?: string): Observation {
  if (id !== undefined) assertPacketId(id);
  const packet: Observation = {
    id: id ?? `an-${t}-${randomUUID().slice(0, 8)}`,
    t,
    channel: "claude-code",
    kind: AGENT_NOTE_KIND,
    text,
  };
  if (!isObservation(packet)) throw new Error("remember: the note does not form a valid Observation packet");
  return packet;
}

/** One JSON file per packet, exactly as hook.mjs spools: written under a
 * `.tmp` name and renamed into place, so a sweep running at the same
 * moment never reads a half-written file. Returns the path. */
export function spoolPacket(spoolDir: string, packet: Observation): string {
  assertPacketId(packet.id);
  mkdirSync(spoolDir, { recursive: true });
  const file = join(spoolDir, `${packet.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(packet) + "\n");
  renameSync(`${file}.tmp`, file);
  return file;
}

function main(): void {
  const args = process.argv.slice(2);
  let text: string | null = null;
  let spool = resolveSpoolDir(join(homedir(), ".mneme"));
  let t: number | null = null;
  let id: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--spool" || a === "--t" || a === "--id") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${a}`);
      if (a === "--spool") spool = resolve(value);
      else if (a === "--id") id = value;
      else {
        if (!/^\d+$/.test(value)) throw new Error(`--t must be Unix milliseconds, got ${JSON.stringify(value)}`);
        t = Number(value);
      }
    } else if (a === "-") {
      text = readFileSync(0, "utf8");
    } else if (a.startsWith("--")) {
      throw new Error(`unknown argument: ${a}`);
    } else if (text === null) {
      text = a;
    } else {
      throw new Error("one note per run; quote the whole note, or pass - to read it from stdin");
    }
  }
  if (text === null || text.trim() === "") {
    throw new Error('nothing to remember: bun run remember "first line is the title, then why" (or - for stdin)');
  }
  // The clock, read once, is this adapter's observation time. --t exists
  // for reproducible fixtures and tests, never for backdating memory.
  const packet = agentNote(text, t ?? Date.now(), id ?? undefined);
  const file = spoolPacket(spool, packet);
  console.log(`remembered ${packet.id} (kind ${AGENT_NOTE_KIND}) → ${file}`);
  console.log(
    "it enters memory on the next `bun run dogfood`, through the secrets gate and one core.permit; " +
      "a human-utterance-only Core refuses agent notes",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    console.error(`remember: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
