/**
 * CLI ergonomics: `--status` (a pure inspection), `--limit`, the
 * display clip, and the package scripts. Every case runs the real CLI
 * and points every path at a temp world so nothing on the machine's
 * real ~/.mneme is read or touched.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "bun:test";
import { emptyCore } from "../src/core.js";
import { clip, DISPLAY_TITLE_MAX } from "../src/display.js";
import { loadStore } from "../src/store.js";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { scanSpool } from "../src/sources.js";
import { trayStatus } from "../src/status.js";
import { drainPackets, hookSnippetJson } from "../src/tray.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELIX_ROOT = resolve(HERE, "..");
const TRAY = join(HELIX_ROOT, "src", "tray.ts");
const kernel = loadKernel();
const run = promisify(execFile);

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `cli-${name}-`));
}

function packet(id: string, kind: string, t: number, text: string): Observation {
  return { id, t, channel: "claude-code", kind, text };
}

/** A world: a spool with one packet and one .bad file, a buffer of three
 * packets (one session-stop, one already remembered, one with a sentinel
 * string that must never be printed), an inbox with one note, and a
 * store holding exactly one of the buffer packets. */
function world(): {
  dir: string; spool: string; buffer: string; inbox: string; store: string; sentinel: string;
} {
  const dir = tmp("world");
  const spool = join(dir, "spool");
  const buffer = join(dir, "buffer.jsonl");
  const inbox = join(dir, "inbox");
  const store = join(dir, "store.json");
  const sentinel = "SENTINEL-PROSE-NEVER-PRINTED";
  mkdirSync(spool, { recursive: true });
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(spool, "cc-spooled.json"), JSON.stringify(packet("cc-spooled", "user-prompt", 1756000000000, "spooled")) + "\n");
  writeFileSync(join(spool, "junk.json.bad"), "not a packet");
  const remembered = packet("cc-old", "user-prompt", 1756000000000, "Remembered already");
  const fresh = packet("cc-fresh", "user-prompt", 1756100000000, `Fresh prompt ${sentinel}`);
  const stop = packet("cc-stop", "session-stop", 1756200000000, "claude-code session stopped");
  writeFileSync(buffer, [remembered, fresh, stop].map((p) => JSON.stringify(p)).join("\n") + "\nnot json\n");
  writeFileSync(join(inbox, "note.md"), "# A note\n\nbody\n");
  drainPackets([remembered], store, emptyCore(), kernel);
  return { dir, spool, buffer, inbox, store, sentinel };
}

describe("--status is a pure inspection", () => {
  it("reports spool, buffer, inbox, and memory counts without consuming or printing anything", async () => {
    const w = world();
    const before = readFileSync(w.store, "utf8");
    const tracesDir = join(HELIX_ROOT, "traces");
    const tracesBefore = existsSync(tracesDir) ? readdirSync(tracesDir).sort() : null;
    const { stdout } = await run("bun", [
      TRAY, "--status",
      "--spool", w.spool, "--buffer", w.buffer, "--inbox", w.inbox, "--store", w.store,
      "--core", join(w.dir, "no-core.json"),
    ]);
    expect(stdout).toContain("1 packet file(s) waiting for a sweep, 1 sidelined as .bad");
    expect(stdout).toContain("3 packet(s) (1 non-packet line(s)) — session-stop 1, user-prompt 2");
    expect(stdout).toContain("observed 2025-08-24T01:46:40.000Z to 2025-08-26T09:20:00.000Z");
    expect(stdout).toContain("buffered, not remembered: session-stop 1, user-prompt 1");
    expect(stdout).toContain("session-stop is punctuation");
    expect(stdout).toContain("1 markdown note(s), 1 not yet remembered");
    expect(stdout).toContain("1 remembered — by channel claude-code 1; by kind user-prompt 1");
    expect(stdout).toContain("next: bun run dogfood (1 spooled + 1 new inbox note(s) to drain)");
    expect(stdout).toContain("no graph ran, no trace written");
    expect(stdout).not.toContain(w.sentinel);
    // Nothing consumed, nothing written.
    expect(readdirSync(w.spool).sort()).toEqual(["cc-spooled.json", "junk.json.bad"]);
    expect(readFileSync(w.store, "utf8")).toBe(before);
    // No trace anywhere: the repo's traces dir is exactly as it was.
    expect(existsSync(tracesDir) ? readdirSync(tracesDir).sort() : null).toEqual(tracesBefore);
    expect(readdirSync(w.dir).sort()).toEqual(["buffer.jsonl", "inbox", "spool", "store.json"]);
  });

  it("reports the listener socket where the hook and listener look: MNEME_SOCK, never beside the buffer", async () => {
    const w = world();
    const args = ["--status", "--spool", w.spool, "--buffer", w.buffer, "--inbox", w.inbox,
      "--store", w.store, "--core", join(w.dir, "no-core.json")];
    const sock = join(w.dir, "helix.sock");
    const env = { ...process.env, MNEME_SOCK: sock };
    const absent = await run("bun", [TRAY, ...args], { env });
    expect(absent.stdout).toContain(`listener socket ${sock}: absent`);
    writeFileSync(sock, ""); // a stale or live socket path: present, never probed
    const present = await run("bun", [TRAY, ...args], { env });
    expect(present.stdout).toContain(`listener socket ${sock}: present (not probed)`);
    // A relocated buffer does not move the socket: it is not looked for beside it.
    const beside = await run("bun", [TRAY, ...args], { env: { ...process.env, MNEME_SOCK: join(w.dir, "nope.sock") } });
    expect(beside.stdout).not.toContain(`listener socket ${sock}`);
  });

  it("stops recommending a drain once the inbox notes are remembered", async () => {
    const dir = tmp("drained-inbox");
    const inbox = join(dir, "inbox");
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, "a.md"), "# A\n\nbody\n");
    writeFileSync(join(inbox, "b.md"), "# B\n\nbody\n");
    const common = ["--spool", join(dir, "spool"), "--buffer", join(dir, "buffer.jsonl"), "--inbox", inbox,
      "--store", join(dir, "store.json"), "--core", join(dir, "no-core.json")];
    const before = await run("bun", [TRAY, "--status", ...common]);
    expect(before.stdout).toContain("2 markdown note(s), 2 not yet remembered");
    expect(before.stdout).toContain("next: bun run dogfood (0 spooled + 2 new inbox note(s) to drain)");
    await run("bun", [TRAY, "--dogfood", ...common, "--out", join(dir, "t.json")]);
    const after = await run("bun", [TRAY, "--status", ...common]);
    expect(after.stdout).toContain("2 markdown note(s), 0 not yet remembered");
    expect(after.stdout).toContain("next: nothing waiting");
    writeFileSync(join(inbox, "c.md"), "# C\n\nbody\n");
    const again = await run("bun", [TRAY, "--status", ...common]);
    expect(again.stdout).toContain("next: bun run dogfood (0 spooled + 1 new inbox note(s) to drain)");
  });

  it("labels a phrase-only hit by its score, never as an interval hit", async () => {
    const dir = tmp("phrase-only");
    const store = join(dir, "store.json");
    // A phrase made only of stopwords has no content words to match, so
    // the hit is adjacency alone: "phrase only", never an interval claim.
    drainPackets([packet("cc-wwt", "user-prompt", 1756000000000, "What was that")], store, emptyCore(), kernel);
    const { stdout } = await run("bun", [TRAY, "--ask", '"what was that"', "--store", store,
      "--core", join(dir, "no-core.json"), "--out", join(dir, "a.json")]);
    expect(stdout).toContain('cc-wwt — "What was that" (score 2; phrase only)');
    expect(stdout).not.toContain("observation time in interval");
    expect(stdout).not.toContain("tip: --journal");
  });

  it("honours MNEME_SPOOL like the hook does, for --status and for the dogfood sweep", async () => {
    const dir = tmp("env-spool");
    const spool = join(dir, "relocated-spool");
    mkdirSync(spool, { recursive: true });
    writeFileSync(join(spool, "cc-env.json"), JSON.stringify(packet("cc-env", "user-prompt", 1756000000000, "from env")) + "\n");
    const env = { ...process.env, MNEME_SPOOL: spool };
    const common = ["--buffer", join(dir, "buffer.jsonl"), "--inbox", join(dir, "inbox"),
      "--store", join(dir, "store.json"), "--core", join(dir, "no-core.json")];
    const status = await run("bun", [TRAY, "--status", ...common], { env });
    expect(status.stdout).toContain(`spool ${spool}: 1 packet file(s) waiting`);
    const drain = await run("bun", [TRAY, "--dogfood", ...common, "--out", join(dir, "t.json")], { env });
    expect(drain.stdout).toContain(`sweep: 1 spooled packet(s) from ${spool}`);
    expect(Object.keys(loadStore(join(dir, "store.json")).episodic)).toEqual(["ep:cc-env"]);
  });

  it("never recommends a drain for buffer packets alone (they may be Core denials)", async () => {
    const dir = tmp("denied-status");
    const buffer = join(dir, "buffer.jsonl");
    writeFileSync(buffer, JSON.stringify(packet("cc-denied", "tool-result", 1756000000000, "compiler output")) + "\n");
    const { stdout } = await run("bun", [
      TRAY, "--status",
      "--spool", join(dir, "spool"), "--buffer", buffer, "--inbox", join(dir, "inbox"),
      "--store", join(dir, "store.json"), "--core", join(dir, "no-core.json"),
    ]);
    expect(stdout).toContain("buffered, not remembered: tool-result 1");
    expect(stdout).toContain("nothing new is waiting; a re-drain commits any of the 1 un-remembered");
    expect(stdout).not.toContain("next: bun run dogfood (");
  });

  it("accepts --spool, like --dogfood, and refuses it on the single-source drains", async () => {
    const dir = tmp("status-spool");
    await expect(run("bun", [TRAY, "--inbox", join(dir, "i"), "--spool", join(dir, "s"), "--core", join(dir, "no-core.json")]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("--spool is only valid with --dogfood or --status") });
  });

  it("--json emits the same inspection as data, never packet text", async () => {
    const w = world();
    const { stdout } = await run("bun", [
      TRAY, "--status", "--json",
      "--spool", w.spool, "--buffer", w.buffer, "--inbox", w.inbox, "--store", w.store,
      "--core", join(w.dir, "no-core.json"),
    ]);
    const parsed = JSON.parse(stdout) as { core: { values: string[] }; paths: { spoolDir: string }; status: { spool: { waiting: number; bad: number }; buffer: { packets: number }; store: { episodes: number } } };
    expect(parsed.core.values).toEqual([]);
    expect(parsed.paths.spoolDir).toBe(w.spool);
    expect(parsed.status).toMatchObject({ spool: { waiting: 1, bad: 1 }, buffer: { packets: 3 }, store: { episodes: 1 } });
    expect(stdout).not.toContain(w.sentinel);
    await expect(run("bun", [TRAY, "--ask", "x", "--json", "--core", join(w.dir, "no-core.json"), "--store", w.store]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("--json is only valid with --status") });
  });

  it("exits 0 on an empty world and points at --ask", async () => {
    const dir = tmp("empty");
    const { stdout } = await run("bun", [
      TRAY, "--status",
      "--spool", join(dir, "spool"), "--buffer", join(dir, "buffer.jsonl"),
      "--inbox", join(dir, "inbox"), "--store", join(dir, "store.json"),
      "--core", join(dir, "no-core.json"),
    ]);
    expect(stdout).toContain("0 packet file(s) waiting");
    expect(stdout).toContain("0 packet(s) — none");
    expect(stdout).toContain("0 remembered");
    expect(stdout).toContain("nothing waiting");
    expect(existsSync(join(dir, "store.json"))).toBe(false);
  });

  it("is one mode among three, and takes no query flags", async () => {
    const dir = tmp("modes");
    const core = join(dir, "no-core.json");
    await expect(run("bun", [TRAY, "--status", "--ask", "x", "--core", core]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("choose one mode") });
    await expect(run("bun", [TRAY, "--status", "--dogfood", "--core", core]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("choose one mode") });
    await expect(run("bun", [TRAY, "--status", "--as-of", "2026-09-05", "--core", core]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("not valid with --status") });
  });

  it("trayStatus computes the same counts as a plain object", () => {
    const w = world();
    const s = trayStatus({
      spoolDir: w.spool, bufferFile: w.buffer, inboxDir: w.inbox, storeFile: w.store,
      sockPath: join(w.dir, "helix.sock"),
    });
    expect(s.spool).toEqual({ waiting: 1, bad: 1 });
    expect(s.buffer.packets).toBe(3);
    expect(s.buffer.skipped).toBe(1);
    expect(s.buffer.notRemembered).toEqual({ "session-stop": 1, "user-prompt": 1 });
    expect(s.inbox.notes).toBe(1);
    expect(s.store.episodes).toBe(1);
    expect(s.socketPresent).toBe(false);
    expect(scanSpool(join(w.dir, "nope"))).toEqual({ waiting: 0, bad: 0 });
  });
});

describe("--limit and display clipping", () => {
  it("caps how many hits are printed, presentation only", async () => {
    const dir = tmp("limit");
    const store = join(dir, "store.json");
    drainPackets(
      Array.from({ length: 4 }, (_, i) => packet(`cc-${i}`, "user-prompt", 1756000000000 + i, `deploy number ${i}`)),
      store, emptyCore(), kernel,
    );
    const args = ["--ask", "deploy", "--store", store, "--core", join(dir, "no-core.json")];
    const one = await run("bun", [TRAY, ...args, "--limit", "1", "--out", join(dir, "one.json")]);
    expect(one.stdout).toContain("… and 3 more note(s) in this result");
    expect(one.stdout.match(/score 2; matched deploy/g)).toHaveLength(1); // title word: counts double
    const all = await run("bun", [TRAY, ...args, "--limit", "10", "--out", join(dir, "all.json")]);
    expect(all.stdout).not.toContain("more note(s)");
    expect(all.stdout.match(/score 2; matched deploy/g)).toHaveLength(4);
    // The trace is the same whatever the display cap.
    expect(readFileSync(join(dir, "one.json"), "utf8")).toBe(readFileSync(join(dir, "all.json"), "utf8"));
    await expect(run("bun", [TRAY, ...args, "--limit", "0"]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("--limit must be a positive integer") });
    await expect(run("bun", [TRAY, "--dogfood", "--limit", "2", "--core", join(dir, "no-core.json"),
      "--spool", join(dir, "s"), "--buffer", join(dir, "b"), "--inbox", join(dir, "i"), "--store", store]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("--limit is only valid with --ask") });
  });

  it("clips long titles on screen only, marking the cut", async () => {
    expect(clip("short")).toBe("short");
    const long = "w".repeat(DISPLAY_TITLE_MAX + 20);
    expect(clip(long)).toHaveLength(DISPLAY_TITLE_MAX);
    expect(clip(long).endsWith("…")).toBe(true);
    const emoji = clip("😀".repeat(DISPLAY_TITLE_MAX + 5));
    expect(Buffer.from(emoji, "utf8").toString("utf8")).toBe(emoji); // no lone surrogate
    const dir = tmp("clip");
    const store = join(dir, "store.json");
    const text = "deploy " + "again and ".repeat(10).trim(); // > DISPLAY_TITLE_MAX (96), < TITLE_MAX (120)
    drainPackets([packet("cc-long", "user-prompt", 1756000000000, text)], store, emptyCore(), kernel);
    const { stdout } = await run("bun", [
      TRAY, "--ask", "deploy", "--store", store, "--core", join(dir, "no-core.json"), "--out", join(dir, "t.json"),
    ]);
    expect(stdout).toContain("…");
    expect(stdout).not.toContain(`"${text}"`);
    // …while the store holds the full (ingest-clipped) title.
    expect(readFileSync(store, "utf8")).toContain(text);
  });
});

describe("flag order", () => {
  it("refuses a question that is itself a flag instead of swallowing --as-of", async () => {
    const dir = tmp("order");
    await expect(run("bun", [TRAY, "--ask", "--as-of", "2026-09-05", "yesterday",
      "--store", join(dir, "store.json"), "--core", join(dir, "no-core.json")]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("missing value for --ask") });
  });
});

describe("--hook-snippet", () => {
  it("prints the settings.json block with this clone's absolute hook path, and writes nothing", async () => {
    const dir = tmp("snippet");
    const { stdout, stderr } = await run("bun", [TRAY, "--hook-snippet", "--core", join(dir, "no-core.json")]);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout) as {
      hooks: Record<string, { hooks: { type: string; command: string }[] }[]>;
    };
    expect(Object.keys(parsed.hooks).sort()).toEqual(["Stop", "UserPromptSubmit"]);
    for (const event of ["UserPromptSubmit", "Stop"]) {
      const cmd = parsed.hooks[event]?.[0]?.hooks[0];
      expect(cmd?.type).toBe("command");
      expect(cmd?.command.startsWith('node "')).toBe(true);
      // The path is double-quoted so a clone under "My Projects" still runs.
      const hookPath = JSON.parse(cmd?.command.slice("node ".length) as string) as string;
      expect(hookPath).toBe(join(HELIX_ROOT, "adapters", "claude-code", "hook.mjs"));
      expect(existsSync(hookPath)).toBe(true);
    }
    expect(stdout).not.toContain("MNEME_SOCK"); // never environment-dependent
    expect(stdout).toBe(hookSnippetJson() + "\n");
    await expect(run("bun", [TRAY, "--hook-snippet", "--ask", "x", "--core", join(dir, "no-core.json")]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("choose one mode") });
  });
});

describe("package scripts", () => {
  it("expose ask and status entry points that forward their arguments", async () => {
    const dir = tmp("scripts");
    const store = join(dir, "store.json");
    drainPackets([packet("cc-1", "user-prompt", 1756000000000, "canary rollout")], store, emptyCore(), kernel);
    const ask = await run("bun", ["run", "ask", "canary", "--store", store, "--core", join(dir, "no-core.json"),
      "--out", join(dir, "ask.json")], { cwd: HELIX_ROOT });
    expect(ask.stdout).toContain("cc-1");
    const status = await run("bun", ["run", "status", "--store", store, "--spool", join(dir, "s"),
      "--buffer", join(dir, "b"), "--inbox", join(dir, "i"), "--core", join(dir, "no-core.json")], { cwd: HELIX_ROOT });
    expect(status.stdout).toContain("1 remembered");
  });
});
