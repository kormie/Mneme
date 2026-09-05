/**
 * The Monday-afternoon operator command (DOGFOOD.md): one `--dogfood`
 * run drains the live buffer (or the inbox), commits under consume-once
 * permits, judges the emitted trace with the untrusted judge, and prints
 * the three dogfood prompts. These tests drive the real CLI.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  // --core points at a missing file: an absent Core is an empty Core, the
  // documented default behaviour (and keeps the test hermetic against any
  // real ~/.mneme/core.json on the machine running it). --spool likewise
  // points at a missing directory: the sweep would otherwise consume a
  // real ~/.mneme/spool on the machine running the tests.
  const result = run("bun", [
    TRAY, "--dogfood",
    "--spool", join(dir, "no-spool"),
    "--buffer", bufferFile,
    "--inbox", join(dir, "no-inbox"),
    "--store", storeFile,
    "--out", outFile,
    "--core", join(dir, "no-core.json"),
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
    expect(stdout).toContain("committed: 1 (1 new, 0 replaced, 0 unchanged)");
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
      "--spool", join(dir, "no-spool"),
      "--buffer", bufferFile,
      "--inbox", join(dir, "no-inbox"),
      "--store", storeFile,
      "--out", outFile,
      "--core", join(dir, "no-core.json"), // missing Core file = empty Core
    ]);
    expect(stdout).toContain("safety: PASS");
    // The digest accounts for the session-stop: observed, never bound.
    expect(stdout).toContain("observed only (salience 0 — session punctuation, never bound, never memory): 1");
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

describe("--dogfood drains a backlog past the working-memory budget", () => {
  it("commits every buffered packet across batches under --max-slots", async () => {
    const dir = tmp("backlog");
    const bufferFile = join(dir, "buffer.jsonl");
    const storeFile = join(dir, "store.json");
    const outFile = join(dir, "trace.json");
    const base = fixturePacket();
    const packets = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      id: `cc-backlog-${i}`,
      t: base.t + i,
      text: `Prompt number ${i}: keep the loader sorted.`,
    }));
    writeFileSync(bufferFile, packets.map((p) => JSON.stringify(p)).join("\n") + "\n");
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--max-slots", "2",
      "--spool", join(dir, "no-spool"),
      "--buffer", bufferFile,
      "--inbox", join(dir, "no-inbox"),
      "--store", storeFile,
      "--out", outFile,
      "--core", join(dir, "no-core.json"),
    ]);
    expect(stdout).toContain("safety: PASS");
    expect(stdout).not.toContain("deferred");
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic).sort()).toEqual(packets.map((p) => `ep:${p.id}`).sort());
    const trace = JSON.parse(readFileSync(outFile, "utf8")) as TraceFile;
    const rounds = trace.events.filter(
      (e) => e.type === "node.enter" && e.graph === "pg-s2w" && e.node === "sensor-normalize",
    );
    expect(rounds).toHaveLength(3); // ceil(5 / 2), no sweep this run
    expect(permitPairing(trace.events)).toHaveLength(10);
    expect(countType(trace.events, "prompt.audit")).toBe(1);
    expect(judge(kernel, trace.events).traceSafetyFails).toEqual([]);
    // Monday again: the same buffer re-drains as unchanged, one line, and
    // still one permit per write.
    const again = await run("bun", [
      TRAY, "--dogfood",
      "--max-slots", "2",
      "--spool", join(dir, "no-spool"),
      "--buffer", bufferFile,
      "--inbox", join(dir, "no-inbox"),
      "--store", storeFile,
      "--out", outFile,
      "--core", join(dir, "no-core.json"),
    ]);
    expect(again.stdout).toContain("committed: 5 (0 new, 0 replaced, 5 unchanged)");
    expect(again.stdout).toContain("= 5 already remembered, re-committed unchanged (one permit each)");
    expect(again.stdout).not.toContain("cc-backlog-0 [");
    const trace2 = JSON.parse(readFileSync(outFile, "utf8")) as TraceFile;
    expect(permitPairing(trace2.events)).toHaveLength(10);
  });

  it("refuses a bad --max-slots before touching anything", async () => {
    const dir = tmp("backlog-bad");
    await expect(run("bun", [
      TRAY, "--dogfood", "--max-slots", "0",
      "--spool", join(dir, "no-spool"),
      "--buffer", join(dir, "no-buffer.jsonl"),
      "--inbox", join(dir, "no-inbox"),
      "--store", join(dir, "store.json"),
      "--out", join(dir, "trace.json"),
      "--core", join(dir, "no-core.json"),
    ])).rejects.toMatchObject({ code: 1 });
    expect(existsSync(join(dir, "store.json"))).toBe(false);
  });
});

describe("--dogfood source resolution", () => {
  it("drains the inbox when the buffer is absent, exit 0", async () => {
    const dir = tmp("inbox");
    const inbox = join(dir, "mneme-tray");
    const storeFile = join(dir, "store.json");
    writeFileSync(join(dir, "note.md"), ""); // decoy outside the inbox
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, "monday.md"), "# Monday\n\n## Done\n\n- drained the buffer\n");
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--spool", join(dir, "no-spool"),
      "--buffer", join(dir, "no-buffer.jsonl"),
      "--inbox", inbox,
      "--store", storeFile,
      "--out", join(dir, "trace.json"),
      "--core", join(dir, "no-core.json"),
    ]);
    expect(stdout).toContain("0 packet(s) from buffer");
    expect(stdout).toContain("(buffer empty)");
    expect(stdout).toContain("1 note(s) from inbox");
    expect(stdout).toContain("safety: PASS");
    expect(Object.keys(loadStore(storeFile).episodic)).toEqual(["ep:monday.md"]);
  });

  it("drains buffer packets and inbox notes together, buffer first", async () => {
    const dir = tmp("both");
    const bufferFile = join(dir, "buffer.jsonl");
    const inbox = join(dir, "mneme-tray");
    const storeFile = join(dir, "store.json");
    writeFileSync(bufferFile, JSON.stringify(fixturePacket()) + "\n");
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, "monday.md"), "# Monday\n\n## Done\n\n- dropped a note\n");
    const src = dogfoodSource(bufferFile, inbox);
    expect(src.packets.map((p) => p.id)).toEqual([fixturePacket().id, "monday.md"]);
    expect(src).toMatchObject({ fromBuffer: 1, fromInbox: 1, skipped: 0 });
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--spool", join(dir, "no-spool"),
      "--buffer", bufferFile,
      "--inbox", inbox,
      "--store", storeFile,
      "--out", join(dir, "trace.json"),
      "--core", join(dir, "no-core.json"),
    ]);
    expect(stdout).toContain(`1 packet(s) from buffer ${bufferFile} + 1 note(s) from inbox ${inbox}`);
    expect(stdout).toContain("safety: PASS");
    expect(Object.keys(loadStore(storeFile).episodic).sort()).toEqual(
      [`ep:${fixturePacket().id}`, "ep:monday.md"].sort(),
    );
  });

  it("drains nothing when buffer and inbox are both empty: exit 0, no write", async () => {
    const dir = tmp("empty");
    const bufferFile = join(dir, "buffer.jsonl");
    writeFileSync(bufferFile, "\n"); // exists, holds no packets
    const storeFile = join(dir, "store.json");
    const outFile = join(dir, "trace.json");
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--spool", join(dir, "no-spool"),
      "--buffer", bufferFile,
      "--inbox", join(dir, "no-inbox"),
      "--store", storeFile,
      "--out", outFile,
      "--core", join(dir, "no-core.json"),
    ]);
    expect(stdout).toContain("nothing to drain");
    expect(existsSync(storeFile)).toBe(false); // no invented write
    expect(existsSync(outFile)).toBe(false);
    expect(dogfoodSource(bufferFile, join(dir, "no-inbox"))).toEqual({
      packets: [],
      fromBuffer: 0,
      fromInbox: 0,
      skipped: 0,
    });
  });
});

describe("--dogfood sweeps the hook's spool first (no listener needed)", () => {
  it("consumes spooled packets through pg-s2w into the buffer, then drains them", async () => {
    const dir = tmp("sweep");
    const spool = join(dir, "spool");
    const bufferFile = join(dir, "buffer.jsonl");
    const storeFile = join(dir, "store.json");
    const outFile = join(dir, "trace.json");
    const packet = { ...fixturePacket(), id: "cc-spooled-0001" };
    mkdirSync(spool, { recursive: true });
    // Exactly what hook.mjs writes when no listener answers its socket.
    writeFileSync(join(spool, `${packet.id}.json`), JSON.stringify(packet) + "\n");
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--spool", spool,
      "--buffer", bufferFile,
      "--inbox", join(dir, "no-inbox"),
      "--store", storeFile,
      "--out", outFile,
      "--core", join(dir, "no-core.json"),
    ]);
    expect(stdout).toContain("sweep: 1 spooled packet(s)");
    expect(stdout).toContain("1 appended to buffer");
    expect(stdout).toContain("from buffer");
    expect(stdout).toContain("safety: PASS");
    // The spool file was consumed; the buffer now holds the packet verbatim,
    // as a running listener would have left it.
    expect(readdirSync(spool)).toEqual([]);
    const lines = readFileSync(bufferFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual(packet);
    // And it was drained under its own permits, same as any buffered packet.
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic)).toEqual([`ep:${packet.id}`]);
    const trace = JSON.parse(readFileSync(outFile, "utf8")) as TraceFile;
    // One trace for the whole command: the sweep's pg-s2w pass plus the
    // drain's own pg-s2w re-screen, both on declared nodes.
    const sensoryEnters = trace.events.filter(
      (e) => e.type === "node.enter" && e.graph === "pg-s2w" && e.node === "sensor-normalize",
    );
    expect(sensoryEnters).toHaveLength(2);
    const pairs = permitPairing(trace.events);
    expect(pairs).toHaveLength(2);
    for (const p of pairs) expect(p.permitIndex).toBeGreaterThanOrEqual(0);
    expect(judge(kernel, trace.events).traceSafetyFails).toEqual([]);
  });

  it("drops a quarantined spooled packet without buffering it, and drains nothing", async () => {
    const dir = tmp("sweep-quarantine");
    const spool = join(dir, "spool");
    const bufferFile = join(dir, "buffer.jsonl");
    const storeFile = join(dir, "store.json");
    const outFile = join(dir, "trace.json");
    const leaky: Observation = {
      ...fixturePacket(),
      id: "cc-spooled-leaky",
      text: "set AWS_SECRET_ACCESS_KEY=abc123 in the deploy env",
    };
    mkdirSync(spool, { recursive: true });
    writeFileSync(join(spool, `${leaky.id}.json`), JSON.stringify(leaky) + "\n");
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--spool", spool,
      "--buffer", bufferFile,
      "--inbox", join(dir, "no-inbox"),
      "--store", storeFile,
      "--out", outFile,
      "--core", join(dir, "no-core.json"),
    ]);
    expect(stdout).toContain("0 appended to buffer");
    expect(stdout).toContain(`! ${leaky.id}: credential-assignment`);
    expect(stdout).toContain("nothing to drain");
    expect(readdirSync(spool)).toEqual([]); // consumed, never kept
    expect(existsSync(bufferFile)).toBe(false); // never buffered
    expect(existsSync(storeFile)).toBe(false); // no invented write
    // The sweep did schedule pg-s2w, so its sensory-only trace is written.
    const trace = JSON.parse(readFileSync(outFile, "utf8")) as TraceFile;
    expect(trace.events.some((e) => e.type === "store.write")).toBe(false);
    expect(trace.events.some((e) => e.type === "core.permit")).toBe(false);
    expect(trace.events.some((e) => e.type === "edge.fire" && e.edge === "e4")).toBe(true);
    expect(JSON.stringify(trace)).not.toContain("abc123");
  });

  it("refuses --spool outside --dogfood", async () => {
    const dir = tmp("spool-flag");
    await expect(run("bun", [
      TRAY, "--ask", "anything",
      "--spool", join(dir, "spool"),
      "--store", join(dir, "store.json"),
      "--core", join(dir, "no-core.json"),
    ])).rejects.toMatchObject({ code: 1 });
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
