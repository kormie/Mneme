/**
 * `bun run remember`: an agent records one observation on purpose. It
 * is a sensor — it spools one packet with declared agent provenance and
 * stops — and the packet enters memory only through the ordinary
 * dogfood drain: swept through the secrets gate, proposed to the Core
 * one write at a time, refused under human-utterance-only.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "bun:test";
import type { CoreFile } from "../src/core.js";
import { isObservation } from "../src/observation.js";
import { AGENT_NOTE_KIND, agentNote } from "../src/remember.js";
import { loadStore } from "../src/store.js";
import { countType, type TraceFile } from "../src/trace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELIX_ROOT = resolve(HERE, "..");
const REMEMBER = join(HELIX_ROOT, "src", "remember.ts");
const TRAY = join(HELIX_ROOT, "src", "tray.ts");
const SEED = join(HELIX_ROOT, "fixtures", "agent-notes", "helix-2026-09-05.jsonl");
const run = promisify(execFile);

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `remember-${name}-`));
}

function dogfoodArgs(dir: string, spool: string, coreFile?: string): string[] {
  return [
    TRAY, "--dogfood",
    "--spool", spool,
    "--buffer", join(dir, "buffer.jsonl"),
    "--inbox", join(dir, "no-inbox"),
    "--store", join(dir, "store.json"),
    "--out", join(dir, "trace.json"),
    "--core", coreFile ?? join(dir, "no-core.json"),
  ];
}

describe("bun run remember", () => {
  it("spools one agent-note packet with declared provenance and writes nothing else", async () => {
    const dir = tmp("spool");
    const spool = join(dir, "spool");
    const { stdout } = await run("bun", [
      REMEMBER, "STOPWORDS is shared with bodyKeywords\nGrowing it rewrites stored triples on re-drain.",
      "--spool", spool, "--t", "1756000000000", "--id", "an-test-0001",
    ]);
    expect(stdout).toContain(`remembered an-test-0001 (kind ${AGENT_NOTE_KIND})`);
    expect(stdout).toContain("human-utterance-only Core refuses agent notes");
    expect(readdirSync(spool)).toEqual(["an-test-0001.json"]);
    const packet = JSON.parse(readFileSync(join(spool, "an-test-0001.json"), "utf8")) as unknown;
    expect(isObservation(packet)).toBe(true);
    expect(packet).toEqual({
      id: "an-test-0001",
      t: 1756000000000,
      channel: "claude-code",
      kind: AGENT_NOTE_KIND,
      text: "STOPWORDS is shared with bodyKeywords\nGrowing it rewrites stored triples on re-drain.",
    });
    expect(readdirSync(dir)).toEqual(["spool"]); // no store, no buffer, no trace
  });

  it("generates a hook-shaped id from the clock when none is given, and reads stdin with -", async () => {
    const dir = tmp("stdin");
    const spool = join(dir, "spool");
    const child = run("bun", [REMEMBER, "-", "--spool", spool]);
    child.child.stdin?.end("A note from stdin\nwith a second line\n");
    await child;
    const [name] = readdirSync(spool);
    expect(name).toMatch(/^an-\d+-[0-9a-f]{8}\.json$/u);
    const packet = JSON.parse(readFileSync(join(spool, name as string), "utf8")) as { text: string; t: number };
    expect(packet.text).toBe("A note from stdin\nwith a second line\n");
    expect(Number.isFinite(packet.t)).toBe(true);
    const built = agentNote("x", 5, "custom");
    expect(built).toMatchObject({ id: "custom", t: 5, kind: AGENT_NOTE_KIND, channel: "claude-code" });
  });

  it("refuses an --id that is not a single path segment, so a note can never leave the spool", async () => {
    const dir = tmp("id");
    const spool = join(dir, "spool");
    for (const bad of ["../escaped", "a/b", "..", ".", "", "with space", ".hidden"]) {
      await expect(run("bun", [REMEMBER, "note", "--spool", spool, "--id", bad, "--t", "1"]))
        .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("--id must be a single path segment") });
    }
    expect(readdirSync(dir)).toEqual([]);
    expect(() => agentNote("x", 1, "../x")).toThrow(/single path segment/);
    expect(() => agentNote("x", 1, "nul\u0000")).toThrow(/single path segment/); // no NUL through a spawn
    await run("bun", [REMEMBER, "note", "--spool", spool, "--id", "ok-id.v2_3", "--t", "1"]);
    expect(readdirSync(spool)).toEqual(["ok-id.v2_3.json"]); // and no .tmp left behind
  });

  it("refuses an empty note, two notes, a flag-shaped value, and a bad --t", async () => {
    const dir = tmp("refuse");
    const spool = join(dir, "spool");
    for (const args of [
      [],
      ["   "],
      ["one", "two"],
      ["note", "--spool"],
      ["note", "--t", "yesterday"],
      ["note", "--bogus"],
    ]) {
      await expect(run("bun", [REMEMBER, ...args, ...(args.includes("--spool") ? [] : ["--spool", spool])]))
        .rejects.toMatchObject({ code: 1 });
    }
    expect(existsSync(spool)).toBe(false);
  });

  it("enters memory through dogfood's sweep and one permit, and is then askable", async () => {
    const dir = tmp("drain");
    const spool = join(dir, "spool");
    await run("bun", [
      REMEMBER, "The listener stays Core-free\ncore.spec pins the literal empty identity in listen.ts.",
      "--spool", spool, "--t", "1756000000000", "--id", "an-test-0002",
    ]);
    const { stdout } = await run("bun", dogfoodArgs(dir, spool));
    expect(stdout).toContain("sweep: 1 spooled packet(s)");
    expect(stdout).toContain("committed: 1 (1 new, 0 replaced, 0 unchanged)");
    expect(stdout).toContain("safety: PASS");
    const store = loadStore(join(dir, "store.json"));
    expect(store.episodic["ep:an-test-0002"]).toMatchObject({
      kind: AGENT_NOTE_KIND, channel: "claude-code", title: "The listener stays Core-free",
    });
    const trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8")) as TraceFile;
    expect(countType(trace.events, "core.permit")).toBe(2); // episodic + semantic
    const ask = await run("bun", [
      TRAY, "--ask", "listener core-free",
      "--store", join(dir, "store.json"), "--core", join(dir, "no-core.json"), "--out", join(dir, "ask.json"),
    ]);
    expect(ask.stdout).toContain("an-test-0002");
    expect(ask.stdout).toContain("(an-test-0002, kind, agent-note)");
  });

  it("is refused by a human-utterance-only Core: core.deny per item, nothing written", async () => {
    const dir = tmp("denied");
    const spool = join(dir, "spool");
    const coreFile = join(dir, "core.json");
    const huo: CoreFile = { values: ["human-utterance-only"], goals: [], prose: "test" };
    writeFileSync(coreFile, JSON.stringify(huo));
    await run("bun", [REMEMBER, "An agent note", "--spool", spool, "--t", "1756000000000", "--id", "an-test-0003"]);
    const { stdout } = await run("bun", dogfoodArgs(dir, spool, coreFile));
    expect(stdout).toContain("denied by Core");
    expect(stdout).toContain("x an-test-0003");
    expect(stdout).toContain("committed: 0 (0 new, 0 replaced, 0 unchanged)");
    expect(stdout).toContain("safety: PASS");
    expect(Object.keys(loadStore(join(dir, "store.json")).episodic)).toEqual([]);
    const trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8")) as TraceFile;
    expect(countType(trace.events, "core.deny")).toBe(2);
    expect(countType(trace.events, "core.interrupt")).toBe(2);
    expect(countType(trace.events, "store.write")).toBe(1); // audit.inbox only
  });

  it("cannot smuggle a secret past the gate: quarantined at the sweep, never buffered", async () => {
    const dir = tmp("leaky");
    const spool = join(dir, "spool");
    await run("bun", [
      REMEMBER, "Deploy note\nset AWS_SECRET_ACCESS_KEY=abc123 in the deploy env",
      "--spool", spool, "--t", "1756000000000", "--id", "an-test-0004",
    ]);
    const { stdout } = await run("bun", dogfoodArgs(dir, spool));
    expect(stdout).toContain("! an-test-0004: credential-assignment (dropped — never buffered)");
    expect(stdout).toContain("nothing to drain");
    expect(existsSync(join(dir, "buffer.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "store.json"))).toBe(false);
  });
});

describe("the seed of tonight's findings", () => {
  it("is a clean buffer of agent notes that drains under an empty Core and answers questions", async () => {
    const dir = tmp("seed");
    const lines = readFileSync(SEED, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(10);
    for (const line of lines) {
      const p = JSON.parse(line) as { kind: string; channel: string; text: string };
      expect(isObservation(p)).toBe(true);
      expect(p.kind).toBe(AGENT_NOTE_KIND);
      expect(p.channel).toBe("claude-code");
      expect(p.text.split("\n")[0]?.length).toBeLessThanOrEqual(120);
    }
    const { stdout } = await run("bun", [
      TRAY, "--buffer", SEED, "--store", join(dir, "store.json"), "--out", join(dir, "t.json"),
      "--core", join(dir, "no-core.json"),
    ]);
    expect(stdout).toContain("secret scan: no rules matched");
    expect(stdout).toContain(`committed: ${lines.length} (${lines.length} new, 0 replaced, 0 unchanged)`);
    const ask = await run("bun", [
      TRAY, "--ask", "STOPWORDS", "--store", join(dir, "store.json"), "--core", join(dir, "no-core.json"),
      "--out", join(dir, "a.json"),
    ]);
    expect(ask.stdout).toContain("shared with bodyKeywords");
    const gate = await run("bun", [
      TRAY, "--ask", '"import cycle"', "--store", join(dir, "store.json"), "--core", join(dir, "no-core.json"),
      "--out", join(dir, "b.json"),
    ]);
    expect(gate.stdout).toContain("trace-io.ts");
  });
});
