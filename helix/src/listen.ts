/**
 * The sensory adapter loop (ADR-013 slice). Adapters push Observation
 * packets — one JSON per line over a unix socket, or one JSON file each
 * in a spool directory for when the socket is down — and this listener
 * validates them, feeds each batch to pg-s2w's declared ingress `raw`,
 * appends the clean (non-quarantined) packets to the L0 sensory buffer
 * file, and writes a mneme.trace/v1 of everything it scheduled.
 *
 * Boundaries (brief §6, §9): this process runs the sensory→working graph
 * only. It commits nothing to long-term memory and emits no store.write
 * events — consolidation (pg-w2l, one core.permit per write) remains the
 * operator-initiated tray run over what the buffer holds. Retrieval is
 * not here either: retrieve-on-submit is out of this slice (ADAPTER.md).
 */
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { defaultBufferFile, defaultSpoolDir } from "./buffer-path.js";
import { loadKernel, type KernelIR } from "./kernel.js";
import { makeEmitter, runGraph, type Emitter } from "./scheduler.js";
import type { AnomalyFlag, AnomalyMatch } from "./anomaly.js";
import { parseObservation, type Observation } from "./observation.js";
import { sensoryAppliers, type SensedObs } from "./sensory.js";
import { writeTrace } from "./trace-io.js";
import { countType, makeTraceFile, scheduleNonempty, validTrace } from "./trace.js";

export interface SenseResult {
  slots: { id: string; obs: SensedObs }[];
  /** Clean but over the working-memory budget; still buffered. */
  deferred: string[];
  flag: AnomalyFlag | null;
}

/** One pg-s2w invocation over a batch of packets (ingress `raw`). The
 * sensory boundary is Core-free: this senses under the hardcoded empty
 * identity and never loads the Core file — the tray's spool sweep
 * reuses this exact pass, and the drain re-screens under the loaded
 * Core afterwards. */
export function senseBatch(
  kernel: KernelIR,
  packets: Observation[],
  emitter: Emitter,
  maxSlots = 64,
): SenseResult {
  const out = runGraph(
    kernel,
    "pg-s2w",
    {
      raw: packets,
      identity: { values: [], goals: [], style: {} },
      slot_schema: { maxSlots },
    },
    sensoryAppliers(),
    emitter,
  );
  return {
    slots: (out.get("bind")?.slots ?? []) as { id: string; obs: SensedObs }[],
    deferred: (out.get("bind")?.dropped ?? []) as string[],
    flag: (out.get("anomaly")?.flag ?? null) as AnomalyFlag | null,
  };
}

/**
 * Drain a spool directory: every `*.json` file that parses as an
 * Observation packet is consumed (file deleted) and returned in filename
 * order; anything else is renamed `*.bad` so it cannot loop forever.
 */
export function drainSpool(spoolDir: string): Observation[] {
  let names: string[];
  try {
    names = readdirSync(spoolDir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return []; // no spool directory yet — nothing was ever spooled
  }
  const packets: Observation[] = [];
  for (const name of names) {
    const file = join(spoolDir, name);
    const packet = parseObservation(readFileSync(file, "utf8"));
    if (packet === null) {
      renameSync(file, `${file}.bad`);
      continue;
    }
    packets.push(packet);
    unlinkSync(file);
  }
  return packets;
}

export interface BatchReport {
  /** Packet ids appended to the sensory buffer: everything clean, whether
   * it bound into a slot, deferred over budget, or — like session
   * punctuation below the gate's threshold — was observed only. */
  accepted: string[];
  quarantined: AnomalyMatch[];
  deferred: string[];
  slots: number;
}

/**
 * Feed one validated batch through pg-s2w and append the clean packets
 * to the sensory buffer file (one JSON per line). Quarantined packet
 * versions are dropped entirely — never buffered, never logged verbatim.
 */
export function processBatch(
  kernel: KernelIR,
  packets: Observation[],
  emitter: Emitter,
  bufferFile: string,
  maxSlots = 64,
): BatchReport {
  const { slots, deferred, flag } = senseBatch(kernel, packets, emitter, maxSlots);
  const quarantined = new Set(flag?.notes ?? []);
  const clean = packets.filter((p) => !quarantined.has(p.id));
  mkdirSync(dirname(bufferFile), { recursive: true });
  for (const p of clean) appendFileSync(bufferFile, JSON.stringify(p) + "\n");
  return {
    accepted: clean.map((p) => p.id),
    quarantined: flag?.matches ?? [],
    deferred,
    slots: slots.length,
  };
}

export interface ListenChecks {
  validTrace: boolean;
  scheduleNonempty: boolean;
  noStoreWrite: boolean;
  noInstallAckMint: boolean;
}

/** Slice-local checks for a listener trace: sensory only, nothing gated. */
export function listenChecks(kernel: KernelIR, emitter: Emitter): ListenChecks {
  const ev = emitter.events;
  return {
    validTrace: validTrace(kernel, ev),
    scheduleNonempty: scheduleNonempty(ev),
    noStoreWrite: countType(ev, "store.write") === 0,
    noInstallAckMint:
      countType(ev, "twin.install") === 0 &&
      countType(ev, "steward.ack") === 0 &&
      countType(ev, "cap.mint") === 0 &&
      countType(ev, "twin.action") === 0,
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const HELIX_ROOT = resolve(HERE, "..");

interface ListenOptions {
  sockPath: string;
  spoolDir: string;
  bufferFile: string;
  traceFile: string;
  maxSlots: number;
  once: boolean;
}

function defaults(): ListenOptions {
  const base = join(homedir(), ".mneme");
  return {
    sockPath: join(base, "helix.sock"),
    spoolDir: defaultSpoolDir(base),
    bufferFile: defaultBufferFile(base),
    traceFile: join(HELIX_ROOT, "traces", "listen.json"),
    maxSlots: 64,
    once: false,
  };
}

function parseArgs(argv: string[]): ListenOptions {
  const opts = defaults();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    if (flag === "--once") {
      opts.once = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === "--sock") opts.sockPath = resolve(value);
    else if (flag === "--spool") opts.spoolDir = resolve(value);
    else if (flag === "--buffer") opts.bufferFile = resolve(value);
    else if (flag === "--out") opts.traceFile = resolve(value);
    else if (flag === "--max-slots") opts.maxSlots = Number(value);
    else throw new Error(`unknown argument: ${flag}`);
  }
  return opts;
}

function checksOk(c: ListenChecks): boolean {
  return Object.values(c).every(Boolean);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const kernel = loadKernel();
  const emitter = makeEmitter();

  const flush = (): ListenChecks => {
    writeTrace(makeTraceFile(kernel.spec, emitter.events), opts.traceFile);
    return listenChecks(kernel, emitter);
  };

  const report = (label: string, batch: BatchReport): void => {
    const q = batch.quarantined.length > 0
      ? `; quarantined ${batch.quarantined.map((m) => `${m.note} (${m.rule})`).join(", ")}`
      : "";
    console.log(
      `listen: ${label} ${batch.accepted.length} packet(s) → ${batch.slots} slot(s)${q}`,
    );
  };

  const handleBatch = (label: string, packets: Observation[]): void => {
    if (packets.length === 0) return;
    const batch = processBatch(kernel, packets, emitter, opts.bufferFile, opts.maxSlots);
    report(label, batch);
    const checks = flush();
    if (!checksOk(checks)) {
      console.error(`listen: CHECKS FAILED ${JSON.stringify(checks)}`);
      process.exitCode = 1;
    }
  };

  handleBatch("spool", drainSpool(opts.spoolDir));

  if (opts.once) {
    const checks = flush();
    console.log(`listen: trace ${opts.traceFile} (${emitter.events.length} events)`);
    console.log(`listen: checks ${JSON.stringify(checks)}`);
    console.log(`listen: buffer ${opts.bufferFile}`);
    if (emitter.events.length > 0 && !checksOk(checks)) process.exitCode = 1;
    return;
  }

  // One adapter connection = one batch: adapters write newline-delimited
  // packets and close. Invalid lines are counted and skipped, never fatal.
  const onConnection = (sock: Socket): void => {
    let buf = "";
    let skipped = 0;
    const packets: Observation[] = [];
    const take = (line: string): void => {
      if (line.trim() === "") return;
      const p = parseObservation(line);
      if (p === null) skipped += 1;
      else packets.push(p);
    };
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buf += chunk;
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        take(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    sock.on("end", () => {
      take(buf);
      if (skipped > 0) console.error(`listen: skipped ${skipped} invalid line(s)`);
      handleBatch("socket", packets);
    });
    sock.on("error", () => sock.destroy());
  };

  const server: Server = createServer(onConnection);
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EADDRINUSE") throw err;
    // A live listener, or a stale socket file from a crash? Probe it.
    const probe = createConnection(opts.sockPath);
    probe.on("connect", () => {
      probe.end();
      console.error(`listen: another listener already holds ${opts.sockPath}`);
      process.exit(1);
    });
    probe.on("error", () => {
      unlinkSync(opts.sockPath);
      server.listen(opts.sockPath);
    });
  });
  mkdirSync(dirname(opts.sockPath), { recursive: true });
  server.listen(opts.sockPath, () => {
    console.log(`listen: socket ${opts.sockPath}`);
    console.log(`listen: spool ${opts.spoolDir} (swept every 5s)`);
    console.log(`listen: buffer ${opts.bufferFile}; trace ${opts.traceFile}`);
  });

  // Sweep the spool for packets that arrived while the socket was down
  // (or raced a listener restart).
  const sweep = setInterval(() => handleBatch("spool", drainSpool(opts.spoolDir)), 5000);

  const shutdown = (): void => {
    clearInterval(sweep);
    server.close();
    flush();
    process.exit(process.exitCode ?? 0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    console.error(`listen: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
