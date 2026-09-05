/** Operator commands over the existing Helix tray. No background capture. */
import {
  copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { defaultBufferFile } from "./buffer-path.js";
import { loadCore } from "./core.js";
import { clip } from "./display.js";
import { judge } from "./judge.js";
import { loadKernel } from "./kernel.js";
import { parseObservation, type Observation } from "./observation.js";
import { loadStore, saveStore } from "./store.js";
import { assertSupportedCore, drainPackets, runAsk, writeTrace, type DailyAskOptions } from "./tray.js";
import { countType } from "./trace.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_CAPTURE_BYTES = 1024 * 1024;

const HELP = `MNEME — remember your notes, find the context later.

  ./mneme demo                         Try a temporary, fictional notebook
  ./mneme capture "text"               Save a note to your inbox
  ./mneme capture --title "title"      Read a note from piped stdin
  ./mneme remember                     Remember inbox + buffer + spooled notes
  ./mneme recall "garden"              Find saved source excerpts
  ./mneme recent                       Review the last 7 calendar days
  ./mneme status                       Show memory and source locations
  ./mneme doctor                       Check Bun, spec and memory format

Options:
  --home DIR                           Profile (default: MNEME_HOME or ~/.mneme)
  --inbox DIR / --buffer FILE           Sources for remember (both are read)
  --spool DIR                          Spooled adapter packets for remember
  --since YYYY-MM-DD / --until YYYY-MM-DD  Inclusive local dates for recall
  --days N                             Calendar days for recent (default: 7)
  --limit N                            Results (default: 5 recall, 10 recent)
  --title TEXT                         Heading for capture
  --json                               Machine-readable command output

Capture only saves an inbox file; remember commits through Helix.
Offline lexical recall; prompt nodes use deterministic stand-ins.
Run ./scripts/bootstrap.sh for setup. See helix/DAILY.md for daily use.`;

interface Options {
  command: string;
  home: string;
  text: string[];
  values: Record<string, string>;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: "help", home: resolve(process.env.MNEME_HOME ?? join(homedir(), ".mneme")),
    text: [], values: {}, json: false,
  };
  let hasCommand = false;
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!literal && arg === "--") { literal = true; continue; }
    if (!literal && (arg === "--help" || arg === "-h")) return { ...options, command: "help" };
    if (!literal && arg === "--json") { options.json = true; continue; }
    if (!literal && arg.startsWith("--")) {
      if (!["--home", "--inbox", "--buffer", "--spool", "--since", "--until", "--days", "--limit", "--title"].includes(arg)) {
        throw new Error(`unknown option ${arg}; run ./mneme help`);
      }
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      if (arg === "--home") options.home = resolve(value);
      else options.values[arg.slice(2)] = value;
    } else if (!hasCommand) {
      options.command = arg;
      hasCommand = true;
    } else options.text.push(arg);
  }
  const allowed: Record<string, string[]> = {
    help: [], demo: [], capture: ["title"], remember: ["inbox", "buffer", "spool"],
    recall: ["since", "until", "limit"], recent: ["days", "limit"], status: [], doctor: [],
  };
  const flags = allowed[options.command];
  if (!flags) throw new Error(`unknown command ${options.command}; run ./mneme help`);
  for (const key of Object.keys(options.values)) {
    if (!flags.includes(key)) throw new Error(`--${key} is not an option for ${options.command}`);
  }
  if (!["capture", "recall"].includes(options.command) && options.text.length) {
    throw new Error(`${options.command} takes no text arguments`);
  }
  return options;
}

function paths(home: string) {
  return { inbox: join(home, "inbox"), buffer: defaultBufferFile(home), spool: join(home, "spool"),
    store: join(home, "store.json"), core: join(home, "core.json"), traces: join(home, "traces") };
}

function profileCore(home: string) {
  const file = paths(home).core;
  const core = loadCore(file);
  assertSupportedCore(core, file);
  return core;
}

/** Strip terminal control sequences only for display; memory keeps source bytes. */
function display(text: string): string {
  return text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

function positive(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error("--days and --limit must be positive whole numbers");
  }
  return Number(value);
}

function calendarDay(value: string, end = false): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid date ${value}; use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== Number(value.slice(0, 4)) ||
      date.getMonth() + 1 !== Number(value.slice(5, 7)) || date.getDate() !== Number(value.slice(8))) {
    throw new Error(`invalid calendar date ${value}`);
  }
  if (end) date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function inboxPackets(directory: string, explicit: boolean): Observation[] {
  let files;
  try { files = readdirSync(directory, { withFileTypes: true }); }
  catch (err) {
    if (!explicit && (err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`cannot read inbox ${directory}: ${(err as Error).message}`);
  }
  return files.filter((f) => f.isFile() && /\.md$/i.test(f.name))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map((f) => ({ id: f.name, t: Math.floor(statSync(join(directory, f.name)).mtimeMs),
      channel: "file", kind: "note", text: readFileSync(join(directory, f.name), "utf8") }));
}

function bufferPackets(file: string, explicit: boolean): { packets: Observation[]; skipped: number } {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (err) {
    if (!explicit && (err as NodeJS.ErrnoException).code === "ENOENT") return { packets: [], skipped: 0 };
    throw new Error(`cannot read buffer ${file}: ${(err as Error).message}`);
  }
  const packets = new Map<string, Observation>();
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const packet = parseObservation(line);
    if (packet) packets.set(packet.id, packet);
    else skipped++;
  }
  return { packets: [...packets.values()], skipped };
}

function capture(home: string, text: string, title?: string): string {
  if (!text.trim()) throw new Error("capture needs note text or piped stdin");
  if (Buffer.byteLength(text) > MAX_CAPTURE_BYTES) throw new Error("capture is limited to 1 MiB; split this note");
  if (title !== undefined && (!title.trim() || /[\r\n]/.test(title))) throw new Error("--title must be a nonempty single line");
  const inbox = paths(home).inbox;
  mkdirSync(inbox, { recursive: true, mode: 0o700 });
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.md`;
  const file = join(inbox, id);
  const temporary = join(inbox, `.${randomUUID()}.capture`);
  try {
    writeFileSync(temporary, (title ? `# ${title.trim()}\n\n` : "") + text.trim() + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return file;
}

/** Snapshot pending packets without consuming them. The operator's graph
 * run still performs all sensory screening and Core decisions. */
function spoolPackets(directory: string, explicit: boolean) {
  let files;
  try { files = readdirSync(directory, { withFileTypes: true }); }
  catch (err) {
    if (!explicit && (err as NodeJS.ErrnoException).code === "ENOENT") return { packets: [] as Observation[], skipped: 0 };
    throw new Error(`cannot read spool ${directory}: ${(err as Error).message}`);
  }
  const packets: Observation[] = [];
  let skipped = 0;
  for (const file of files.filter((f) => f.isFile() && f.name.endsWith(".json")).sort((a, b) => a.name < b.name ? -1 : 1)) {
    let text;
    try { text = readFileSync(join(directory, file.name), "utf8"); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; // a listener consumed it
      throw err;
    }
    const packet = parseObservation(text);
    if (packet) packets.push(packet); else skipped++;
  }
  return { packets, skipped };
}

function remember(options: Options) {
  const p = paths(options.home);
  const core = profileCore(options.home);
  const inbox = resolve(options.values.inbox ?? p.inbox);
  const buffer = resolve(options.values.buffer ?? p.buffer);
  const notes = inboxPackets(inbox, options.values.inbox !== undefined);
  const buffered = bufferPackets(buffer, options.values.buffer !== undefined);
  const spooled = spoolPackets(resolve(options.values.spool ?? p.spool), options.values.spool !== undefined);
  const adapterPackets = new Map<string, Observation>();
  for (const packet of [...buffered.packets, ...spooled.packets]) {
    const previous = adapterPackets.get(packet.id);
    if (!previous || packet.t > previous.t) adapterPackets.set(packet.id, packet);
    else if (packet.t === previous.t && (packet.text !== previous.text || packet.kind !== previous.kind || packet.channel !== previous.channel)) {
      throw new Error(`conflicting adapter packets with id ${packet.id}; resolve the source conflict before remembering`);
    }
  }
  const ids = new Set(notes.map((n) => n.id));
  for (const packet of adapterPackets.values()) {
    if (ids.has(packet.id)) throw new Error(`source id collision: ${packet.id}; rename the inbox note before remembering`);
  }
  const packets = [...notes, ...adapterPackets.values()];
  const skipped = buffered.skipped + spooled.skipped;
  if (!packets.length) return { remembered: 0, fresh: 0, replaced: 0, unchanged: 0,
    quarantined: [], denied: [] as string[], observedOnly: 0, skipped,
    total: Object.keys(loadStore(p.store).episodic).length, store: p.store, trace: null, batches: 0 };
  mkdirSync(options.home, { recursive: true, mode: 0o700 });
  const lock = join(options.home, ".remember-lock");
  try { mkdirSync(lock); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`another remember may be running (${lock}); if it crashed, remove this lock directory after checking no writer is active`);
    }
    throw err;
  }
  let staging: string | undefined;
  try {
    const kernel = loadKernel();
    staging = mkdtempSync(join(options.home, ".remember-"));
    const stagedStore = join(staging, "store.json");
    saveStore(stagedStore, loadStore(p.store));
    const report = drainPackets(packets, stagedStore, core, kernel);
    if (!Object.values(report.checks).every(Boolean) || !judge(kernel, report.trace.events).judged) {
      throw new Error("Helix trace checks failed; existing memory was preserved");
    }
    for (const event of ["twin.install", "steward.ack", "cap.mint", "cap.revoke", "twin.action", "cluster.cut", "archive.sample"] as const) {
      if (countType(report.trace.events, event)) throw new Error(`unexpected ${event}; existing memory was preserved`);
    }
    if (report.deferred.length) throw new Error("unexpected deferred notes; existing memory was preserved");
    const trace = join(p.traces, `remember-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
    writeTrace(report.trace, trace);
    saveStore(p.store, loadStore(stagedStore));
    return { remembered: report.committed.length, fresh: report.fresh.length, replaced: report.replaced.length,
      unchanged: report.unchanged.length, quarantined: report.quarantined, denied: report.denied,
      observedOnly: report.observedOnly.length, skipped,
      total: Object.keys(loadStore(p.store).episodic).length, store: p.store, trace, batches: Math.ceil(packets.length / 64) };
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    rmSync(lock, { recursive: true });
  }
}

function printRemember(result: ReturnType<typeof remember>): void {
  console.log(result.remembered ? `Remembered ${result.remembered} note(s). ${result.total} in memory.` : "Nothing new remembered.");
  if (result.remembered) console.log(`${result.fresh} new · ${result.replaced} updated · ${result.unchanged} unchanged`);
  for (const q of result.quarantined) console.log(`Quarantined: ${display(q.note)} (${q.rule}). Earlier clean versions may remain in memory.`);
  for (const note of result.denied) console.log(`Core refused: ${display(note)}. Earlier committed versions may remain.`);
  if (result.observedOnly) console.log(`${result.observedOnly} session marker(s) observed without entering memory.`);
  if (result.skipped) console.log(`Skipped ${result.skipped} malformed adapter record(s).`);
  if (result.trace) console.log(`Trace saved. Write checks passed (untrusted).`);
  console.log(`Memory: ${result.store}`);
}

function recall(options: Options) {
  const recent = options.command === "recent";
  const question = options.text.join(" ").trim();
  if (!recent && !question) throw new Error("recall needs a search query; use recent to browse memory");
  const filters: DailyAskOptions = { limit: positive(options.values.limit, recent ? 10 : 5), recent };
  if (recent) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - positive(options.values.days, 7) + 1);
    if (!Number.isFinite(start.getTime())) throw new Error("--days is outside the supported date range");
    filters.since = start.getTime();
    const end = new Date(); end.setHours(23, 59, 59, 999); filters.until = end.getTime();
  } else {
    if (options.values.since) filters.since = calendarDay(options.values.since);
    if (options.values.until) filters.until = calendarDay(options.values.until, true);
  }
  const p = paths(options.home);
  // The operator-facing command supplies its clock as input; graph
  // execution remains deterministic, as in the lower-level --as-of CLI.
  const now = new Date();
  const asOf = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const offsetMinutes = -now.getTimezoneOffset();
  const utcOffset = `${offsetMinutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(offsetMinutes) % 60).padStart(2, "0")}`;
  filters.clock = { asOf, utcOffset };
  const result = runAsk(question, p.store, profileCore(options.home), loadKernel(), undefined, undefined, filters);
  if (!Object.values(result.checks).every(Boolean) || countType(result.trace.events, "store.write")) throw new Error("recall trace checks failed");
  const trace = join(p.traces, recent ? "recent.json" : "recall.json");
  writeTrace(result.trace, trace);
  return { ...result, traceFile: trace };
}

function printRecall(result: ReturnType<typeof recall>): void {
  console.log(`${result.hits.length} match(es) in ${result.storeNotes} remembered note(s).`);
  for (const [i, hit] of result.hits.entries()) {
    console.log(`\n${i + 1}. ${clip(display(hit.title))}`);
    console.log(`   ${display(hit.note)}${hit.observationTimeMs === undefined ? "" : ` · ${new Date(hit.observationTimeMs).toLocaleDateString("en-CA")}`} · ${hit.channel ?? "file"}`);
    console.log(`   ${display(hit.excerpt ?? "No saved excerpt in this older memory. Re-ingest the source to add one.").split("\n").join("\n   ")}`);
  }
  if (!result.storeNotes) console.log("Capture a note, then run ./mneme remember.");
  else if (!result.hits.length) console.log("Try a name or topic from the source, or ./mneme recent --days 30.");
}

function status(home: string) {
  const p = paths(home);
  const store = loadStore(p.store);
  const buffered = bufferPackets(p.buffer, false);
  const spooled = spoolPackets(p.spool, false);
  return { home, notes: Object.keys(store.episodic).length, inboxNotes: inboxPackets(p.inbox, false).length,
    bufferPackets: buffered.packets.length, spoolPackets: spooled.packets.length,
    skippedBufferLines: buffered.skipped, skippedSpoolFiles: spooled.skipped, ...p };
}

function doctor(home: string) {
  const pin = readFileSync(join(ROOT, "helix/.bun-version"), "utf8").trim();
  const version = Bun.version.split(".").map(Number);
  const target = pin.split(".").map(Number);
  const bunOk = (version[0]! > target[0]!) || (version[0] === target[0] &&
    (version[1]! > target[1]! || (version[1] === target[1] && version[2]! >= target[2]!)));
  const verify = spawnSync("bash", [join(ROOT, "scripts/verify-spec.sh")], { cwd: ROOT, encoding: "utf8" });
  const info = status(home);
  const core = profileCore(home);
  return { ok: bunOk && verify.status === 0, bun: Bun.version, requiredBun: pin, bunOk,
    specOk: verify.status === 0, spec: (verify.stdout || verify.stderr).trim(), coreValues: core.values.length, ...info };
}

function demo(): void {
  const home = mkdtempSync(join(tmpdir(), "mneme-demo-"));
  console.log("MNEME · a note now, useful context later\n");
  console.log("Temporary fictional notebook. Your personal memory is untouched.\n");
  mkdirSync(join(home, "inbox"));
  for (const file of readdirSync(join(ROOT, "helix/fixtures/daily"))) {
    copyFileSync(join(ROOT, "helix/fixtures/daily", file), join(home, "inbox", file));
  }
  console.log("$ ./mneme remember");
  const options = parseArgs(["--home", home, "remember"]);
  const result = remember(options);
  printRemember(result);
  console.log('\n$ ./mneme recall "garden"');
  printRecall(recall(parseArgs(["--home", home, "recall", "garden"])));
  console.log('\n$ ./mneme recall \'"borrow the trolley"\'');
  printRecall(recall(parseArgs(["--home", home, "recall", '"borrow the trolley"'])));
  console.log(`\nTry your own query: ./mneme --home ${home} recall "Saturday"`);
  console.log("\nLocal files. No model or network. Runtime certification remains blocked on spec 0.11.");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  if (options.command === "help") { console.log(HELP); return; }
  if (options.command === "demo") {
    if (options.json) throw new Error("demo is a human-readable walkthrough; other commands support --json");
    demo(); return;
  }
  if (options.command === "capture") {
    profileCore(options.home);
    let text = options.text.join(" ");
    if (!text) {
      if (process.stdin.isTTY) throw new Error("provide note text or pipe stdin: printf 'note' | ./mneme capture");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length;
        if (size > MAX_CAPTURE_BYTES) throw new Error("capture is limited to 1 MiB; split this note");
        chunks.push(bytes);
      }
      text = Buffer.concat(chunks).toString("utf8");
    }
    const file = capture(options.home, text, options.values.title);
    if (options.json) console.log(JSON.stringify({ captured: file, remembered: false }));
    else console.log(`Captured: ${file}\nRun ./mneme --home ${JSON.stringify(options.home)} remember to add it to memory.`);
  } else if (options.command === "remember") {
    const result = remember(options);
    if (options.json) console.log(JSON.stringify(result)); else printRemember(result);
  } else if (options.command === "recall" || options.command === "recent") {
    const result = recall(options);
    if (options.json) console.log(JSON.stringify(result)); else printRecall(result);
  } else if (options.command === "status") {
    profileCore(options.home);
    const result = status(options.home);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`${result.notes} remembered note(s).\n${result.inboxNotes} inbox note(s), ${result.bufferPackets} buffered packet(s), ${result.spoolPackets} spooled packet(s) available to remember.\nSources stay in place; re-remembering replaces entries by id.\nMemory: ${result.store}\nCore: ${result.core}\nInbox: ${result.inbox}\nBuffer: ${result.buffer}\nSpool: ${result.spool}\nTraces: ${result.traces}`);
  } else {
    const result = doctor(options.home);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`Bun ${result.bun}: ${result.bunOk ? "OK" : `needs >=${result.requiredBun}; run ./scripts/bootstrap.sh`}\n${result.spec}\nMemory format: OK (${result.notes} notes)\nProfile: ${result.home}\nFull validation: bun test in helix; lake build in proofs.`);
    if (!result.ok) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  main().catch((error: unknown) => {
    console.error(`mneme: ${display(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = 1;
  });
}
