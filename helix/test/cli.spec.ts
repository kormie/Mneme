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
    expect(stdout).toContain("1 markdown note(s)");
    expect(stdout).toContain("1 remembered — by channel claude-code 1; by kind user-prompt 1");
    expect(stdout).toContain("next: bun run dogfood (1 spooled + 1 inbox note(s) to drain)");
    expect(stdout).toContain("no graph ran, no trace written");
    expect(stdout).not.toContain(w.sentinel);
    // Nothing consumed, nothing written.
    expect(readdirSync(w.spool).sort()).toEqual(["cc-spooled.json", "junk.json.bad"]);
    expect(readFileSync(w.store, "utf8")).toBe(before);
    expect(existsSync(join(HELIX_ROOT, "traces", "status.json"))).toBe(false);
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
