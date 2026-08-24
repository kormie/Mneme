/**
 * The Monday-afternoon operator command (DOGFOOD.md): one `--dogfood`
 * run drains the live buffer (or the inbox), commits under consume-once
 * permits, judges the emitted trace with the untrusted judge, and prints
 * the three dogfood prompts. These tests drive the real CLI.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "bun:test";
import { judge } from "../src/judge.js";
import { loadKernel } from "../src/kernel.js";
import { isObservation, type Observation } from "../src/observation.js";
import { loadStore } from "../src/store.js";
import { dogfoodSource, permitPairing } from "../src/tray.js";
import { countType, type TraceFile } from "../src/trace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELIX_ROOT = resolve(HERE, "..");
const TRAY = join(HELIX_ROOT, "src", "tray.ts");
const HOOK = join(HELIX_ROOT, "adapters", "claude-code", "hook.mjs");
const kernel = loadKernel();
const run = promisify(execFile);

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `dogfood-${name}-`));
}

function fixturePacket(): Observation {
  const packet = JSON.parse(
    readFileSync(
      join(HELIX_ROOT, "fixtures", "adapters", "claude-code-user-prompt.json"),
      "utf8",
    ),
  ) as Observation;
  expect(isObservation(packet)).toBe(true);
  return packet;
}

describe("--dogfood over a fixture buffer", () => {
  const dir = tmp("buffer");
  const packet = fixturePacket();
  const bufferFile = join(dir, "buffer.jsonl");
  const storeFile = join(dir, "store.json");
  const outFile = join(dir, "trace.json");
  writeFileSync(bufferFile, JSON.stringify(packet) + "\n");

  // One real CLI run, shared by the assertions below. execFile rejects on
  // a non-zero exit, so reaching the assertions is itself the exit-0 check.
  const result = run("bun", [
    TRAY, "--dogfood",
    "--buffer", bufferFile,
    "--inbox", join(dir, "no-inbox"),
    "--store", storeFile,
    "--out", outFile,
  ]);

  it("drains the packet into the store under its own permit, exit 0", async () => {
    await result;
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic)).toEqual([`ep:${packet.id}`]);
    expect(Object.keys(store.semantic)).toEqual([packet.id]);
    expect(store.episodic[`ep:${packet.id}`]?.channel).toBe("claude-code");
  });

  it("emits a trace whose non-audit writes each consumed one permit", async () => {
    await result;
    const trace = JSON.parse(readFileSync(outFile, "utf8")) as TraceFile;
    expect(trace.trace).toBe("mneme.trace/v1");
    const ltmWrites = trace.events.filter(
      (e) => e.type === "store.write" && e.store !== "audit.inbox",
    );
    expect(ltmWrites.length).toBe(2); // episodic + semantic for the one packet
    const pairs = permitPairing(trace.events);
    expect(pairs).toHaveLength(ltmWrites.length);
    for (const p of pairs) expect(p.permitIndex).toBeGreaterThanOrEqual(0);
    expect(new Set(pairs.map((p) => p.permitIndex)).size).toBe(pairs.length);
    expect(countType(trace.events, "core.permit")).toBe(ltmWrites.length);
  });

  it("judges the trace: safety passes, the two liveness gaps stay fail", async () => {
    await result;
    const trace = JSON.parse(readFileSync(outFile, "utf8")) as TraceFile;
    const j = judge(kernel, trace.events);
    expect(j.judged).toBe(true);
    expect(j.decidable.fail).toBe(0);
    expect(j.traceSafetyFails).toEqual([]);
    const liveness = j.rows.filter((r) => r.liveness);
    expect(liveness.map((r) => r.lean).sort()).toEqual([
      "Mneme.Trace.HasArchiveSample",
      "Mneme.Trace.HasClusterCut",
    ]);
    for (const r of liveness) expect(r.status).toBe("fail");
  });

  it("prints the safety verdict, the liveness gaps, and the three prompts", async () => {
    const { stdout } = await result;
    expect(stdout).toContain("safety: PASS");
    expect(stdout).toContain("Mneme.Trace.HasClusterCut: fail");
    expect(stdout).toContain("Mneme.Trace.HasArchiveSample: fail");
    expect(stdout).toContain("1. Useful?");
    expect(stdout).toContain("2. Creepy?");
    expect(stdout).toContain("3. Missing Core clause?");
    expect(stdout).toContain("judged is not certified");
  });
});

describe("--dogfood over a buffer mixing session-stop and user-prompt", () => {
  it("commits only the user-prompt; session-stop stays an observation", async () => {
    const dir = tmp("mixed");
    const prompt = fixturePacket();
    const stop = JSON.parse(
      readFileSync(
        join(HELIX_ROOT, "fixtures", "adapters", "claude-code-session-stop.json"),
        "utf8",
      ),
    ) as Observation;
    expect(isObservation(stop)).toBe(true);
    const bufferFile = join(dir, "buffer.jsonl");
    writeFileSync(
      bufferFile,
      JSON.stringify(stop) + "\n" + JSON.stringify(prompt) + "\n",
    );
    const storeFile = join(dir, "store.json");
    const outFile = join(dir, "trace.json");
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--buffer", bufferFile,
      "--inbox", join(dir, "no-inbox"),
      "--store", storeFile,
      "--out", outFile,
    ]);
    expect(stdout).toContain("safety: PASS");
    // The store holds the user prompt, under its own permits, and no
    // trace of the session-stop id in any store.write key.
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic)).toEqual([`ep:${prompt.id}`]);
    expect(Object.keys(store.semantic)).toEqual([prompt.id]);
    const trace = JSON.parse(readFileSync(outFile, "utf8")) as TraceFile;
    for (const e of trace.events) {
      if (e.type === "store.write") {
        expect(e.keys.join(), "session-stop id leaked into a write key").not.toContain(stop.id);
      }
    }
    const pairs = permitPairing(trace.events);
    expect(pairs).toHaveLength(2); // episodic + semantic for the one prompt
    for (const p of pairs) expect(p.permitIndex).toBeGreaterThanOrEqual(0);
  });
});

describe("--dogfood source resolution", () => {
  it("falls back to the inbox when the buffer is absent, exit 0", async () => {
    const dir = tmp("inbox");
    const inbox = join(dir, "mneme-tray");
    const storeFile = join(dir, "store.json");
    writeFileSync(join(dir, "note.md"), ""); // decoy outside the inbox
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, "monday.md"), "# Monday\n\n## Done\n\n- drained the buffer\n");
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--buffer", join(dir, "no-buffer.jsonl"),
      "--inbox", inbox,
      "--store", storeFile,
      "--out", join(dir, "trace.json"),
    ]);
    expect(stdout).toContain("(buffer empty)");
    expect(stdout).toContain("safety: PASS");
    expect(Object.keys(loadStore(storeFile).episodic)).toEqual(["ep:monday.md"]);
  });

  it("prefers a buffer with packets over a populated inbox", () => {
    const dir = tmp("prefer");
    const bufferFile = join(dir, "buffer.jsonl");
    writeFileSync(bufferFile, JSON.stringify(fixturePacket()) + "\n");
    const src = dogfoodSource(bufferFile, join(HELIX_ROOT, "fixtures", "tray"));
    expect(src.kind).toBe("buffer");
  });

  it("drains nothing when buffer and inbox are both empty: exit 0, no write", async () => {
    const dir = tmp("empty");
    const bufferFile = join(dir, "buffer.jsonl");
    writeFileSync(bufferFile, "\n"); // exists, holds no packets
    const storeFile = join(dir, "store.json");
    const outFile = join(dir, "trace.json");
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--buffer", bufferFile,
      "--inbox", join(dir, "no-inbox"),
      "--store", storeFile,
      "--out", outFile,
    ]);
    expect(stdout).toContain("nothing to drain");
    expect(existsSync(storeFile)).toBe(false); // no invented write
    expect(existsSync(outFile)).toBe(false);
    expect(dogfoodSource(bufferFile, join(dir, "no-inbox"))).toEqual({
      kind: "nothing",
      skipped: 0,
    });
  });
});

describe("the adapter boundary still holds", () => {
  it("hook.mjs contains no store write and no transcript scrape", () => {
    const src = readFileSync(HOOK, "utf8");
    expect(src).not.toContain("store.write");
    expect(src).not.toContain("transcript_path");
    expect(src).not.toContain(".claude/projects");
    expect(src).not.toContain("jsonl");
  });
});
