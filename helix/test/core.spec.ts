/**
 * The steward-owned Core file (src/core.ts) and the ValueFilter
 * stand-in's one implemented predicate, "human-utterance-only"
 * (src/tray.ts). Loading is strict — a constitution is never silently
 * disabled — and the deny path runs the declared pg-core wiring for
 * real: a reject routes on edge c5 to InterruptEmit (core.deny then
 * core.interrupt), per write item, while the rest of the drain
 * continues under its own consume-once permits.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "bun:test";
import { coreSnapshot, emptyCore, loadCore, type CoreFile } from "../src/core.js";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { makeEmitter, runGraph } from "../src/scheduler.js";
import { emptyStore, loadStore, type Episode, type Triple } from "../src/store.js";
import { countType, denyImpliesInterrupt, type TraceFile } from "../src/trace.js";
import { drainPackets, permitPairing, trayAppliers } from "../src/tray.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELIX_ROOT = resolve(HERE, "..");
const TRAY = join(HELIX_ROOT, "src", "tray.ts");
const kernel = loadKernel();
const run = promisify(execFile);

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `core-${name}-`));
}

/** A constitution holding the one implemented value. The prose here is
 * test data, not the steward's words; prose is never interpreted. */
const HUO: CoreFile = {
  values: ["human-utterance-only"],
  goals: ["remember my own words"],
  prose: "test prose — never interpreted, never in the snapshot",
};

function packet(
  id: string,
  kind: string,
  channel: "file" | "claude-code",
  text: string,
): Observation {
  return { id, t: 1756000000000, channel, kind, text };
}

describe("loading the Core file", () => {
  it("treats a missing file as an empty Core", () => {
    expect(loadCore(join(tmp("absent"), "core.json"))).toEqual(emptyCore());
  });

  it("throws on bad JSON instead of loading as empty", () => {
    const file = join(tmp("badjson"), "core.json");
    writeFileSync(file, "{ not json");
    expect(() => loadCore(file)).toThrow(/not JSON/);
  });

  it("throws when values is not a string array", () => {
    const file = join(tmp("badvalues"), "core.json");
    writeFileSync(file, JSON.stringify({ values: 1, goals: [], prose: "" }));
    expect(() => loadCore(file)).toThrow(/"values" must be an array of strings/);
    writeFileSync(file, JSON.stringify({ values: ["ok", 3], goals: [], prose: "" }));
    expect(() => loadCore(file)).toThrow(/"values" must be an array of strings/);
  });

  it("throws on a misspelled or unrecognized key (never silently no-values)", () => {
    const file = join(tmp("mispelt"), "core.json");
    writeFileSync(file, JSON.stringify({ value: ["human-utterance-only"], goals: [], prose: "" }));
    expect(() => loadCore(file)).toThrow(/unrecognized key/);
  });

  it("throws when goals or prose are missing or mistyped", () => {
    const file = join(tmp("shape"), "core.json");
    writeFileSync(file, JSON.stringify({ values: [], prose: "" }));
    expect(() => loadCore(file)).toThrow(/"goals"/);
    writeFileSync(file, JSON.stringify({ values: [], goals: [], prose: 7 }));
    expect(() => loadCore(file)).toThrow(/"prose"/);
    writeFileSync(file, JSON.stringify(["values"]));
    expect(() => loadCore(file)).toThrow(/expected/);
  });

  it("loads a well-shaped file verbatim, and prose never enters the snapshot", () => {
    const file = join(tmp("ok"), "core.json");
    writeFileSync(file, JSON.stringify(HUO));
    const core = loadCore(file);
    expect(core).toEqual(HUO);
    const snapshot = coreSnapshot(core);
    expect(snapshot).toEqual({
      values: ["human-utterance-only"],
      goals: ["remember my own words"],
      style: {},
    });
    expect("prose" in snapshot).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("test prose");
  });
});

describe("an empty Core keeps today's behaviour", () => {
  it("passes every salient kind, one permit per write, and persists kind", () => {
    const storeFile = join(tmp("empty-core"), "store.json");
    const report = drainPackets(
      [
        packet("aa-paste", "tool-result", "claude-code", "# Pasted output\ncompiler said ok"),
        packet("note.md", "note", "file", "# Standup\n\n## Done\n\n- shipped"),
        packet("zz-prompt", "user-prompt", "claude-code", "Refactor the loader."),
      ],
      storeFile,
      kernel,
      64,
      emptyCore(),
    );
    expect(report.denied).toEqual([]);
    expect(report.committed).toEqual(["aa-paste", "note.md", "zz-prompt"]);
    expect(countType(report.trace.events, "core.deny")).toBe(0);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
    const store = loadStore(storeFile);
    expect(store.episodic["ep:aa-paste"]?.kind).toBe("tool-result");
    expect(store.episodic["ep:note.md"]?.kind).toBe("note");
    expect(store.semantic["zz-prompt"]).toContainEqual({
      s: "zz-prompt",
      p: "kind",
      o: "user-prompt",
    });
  });
});

describe("human-utterance-only over a mixed drain", () => {
  const storeFile = join(tmp("huo"), "store.json");
  // The denied id sorts first so the trace itself proves the drain
  // continued past a deny: denies, then later notes' permits.
  const report = drainPackets(
    [
      packet("aa-paste", "tool-result", "claude-code", "# Pasted output\ncompiler said ok"),
      packet("note.md", "note", "file", "# Standup\n\n## Done\n\n- shipped"),
      packet("zz-prompt", "user-prompt", "claude-code", "Refactor the loader."),
    ],
    storeFile,
    kernel,
    64,
    HUO,
  );
  const events = report.trace.events;

  it("commits note and user-prompt with kind persisted on episode and triple", () => {
    expect(report.committed).toEqual(["note.md", "zz-prompt"]);
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic).sort()).toEqual(["ep:note.md", "ep:zz-prompt"]);
    expect(store.episodic["ep:note.md"]?.kind).toBe("note");
    expect(store.episodic["ep:zz-prompt"]?.kind).toBe("user-prompt");
    expect(store.semantic["note.md"]).toContainEqual({ s: "note.md", p: "kind", o: "note" });
    expect(store.semantic["zz-prompt"]).toContainEqual({
      s: "zz-prompt",
      p: "kind",
      o: "user-prompt",
    });
  });

  it("denies the non-utterance kind on BOTH items: no write, nothing stored", () => {
    expect(report.denied).toEqual(["aa-paste"]);
    const store = loadStore(storeFile);
    expect(store.episodic["ep:aa-paste"]).toBeUndefined();
    expect(store.semantic["aa-paste"]).toBeUndefined();
    for (const e of events) {
      if (e.type === "store.write") {
        expect(e.keys.join(), "denied id leaked into a write key").not.toContain("aa-paste");
      }
    }
  });

  it("emits core.deny + core.interrupt per denied item via declared edge c5", () => {
    expect(countType(events, "core.deny")).toBe(2); // episodic + semantic item
    expect(countType(events, "core.interrupt")).toBe(2);
    expect(denyImpliesInterrupt(events)).toBe(true);
    expect(
      events.filter((e) => e.type === "edge.fire" && e.edge === "c5"),
    ).toHaveLength(2);
    expect(
      events.filter(
        (e) => e.type === "node.enter" && e.graph === "pg-core" && e.node === "interrupt",
      ),
    ).toHaveLength(2);
  });

  it("continues the drain after a deny (c5 divert, not a process abort)", () => {
    const firstDeny = events.findIndex((e) => e.type === "core.deny");
    const firstPermit = events.findIndex((e) => e.type === "core.permit");
    expect(firstDeny).toBeGreaterThanOrEqual(0);
    expect(firstPermit).toBeGreaterThan(firstDeny); // permits happen after the deny
    expect(countType(events, "core.permit")).toBe(4); // 2 notes x 2 items
    const pairs = permitPairing(events);
    expect(pairs).toHaveLength(4);
    for (const p of pairs) expect(p.permitIndex).toBeGreaterThanOrEqual(0);
    expect(new Set(pairs.map((p) => p.permitIndex)).size).toBe(pairs.length);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });

  it("is deterministic: same packets, same store, same Core, same trace", () => {
    const again = drainPackets(
      [
        packet("aa-paste", "tool-result", "claude-code", "# Pasted output\ncompiler said ok"),
        packet("note.md", "note", "file", "# Standup\n\n## Done\n\n- shipped"),
        packet("zz-prompt", "user-prompt", "claude-code", "Refactor the loader."),
      ],
      join(tmp("huo-again"), "store.json"),
      kernel,
      64,
      HUO,
    );
    expect(again.trace).toEqual(report.trace);
  });
});

describe("the ValueFilter stand-in, one pg-core invocation at a time", () => {
  function runFilter(core: CoreFile, proposal: unknown) {
    const emitter = makeEmitter();
    const appliers = trayAppliers(kernel, emitter, emptyStore(), core);
    const out = runGraph(
      kernel,
      "pg-core",
      { core_store: coreSnapshot(core), proposal },
      appliers,
      emitter,
    );
    const verdict = out.get("value-filter")?.verdict as
      | { kind: string; cited_clauses: string[] }
      | undefined;
    return { verdict, events: emitter.events };
  }

  const episode = (kind?: string): Episode => ({
    id: "ep:x",
    note: "x",
    title: "x",
    headings: [],
    channel: "file",
    ...(kind === undefined ? {} : { kind }),
  });
  const triples = (kind?: string): Triple[] => [
    { s: "x", p: "titled", o: "x" },
    ...(kind === undefined ? [] : [{ s: "x", p: "kind", o: kind }]),
  ];

  it("passes everything under an empty Core, permitting each item", () => {
    const { verdict, events } = runFilter(emptyCore(), {
      store: "episodic",
      key: "ep:x",
      value: episode(), // even an unknown kind passes with no constitution
    });
    expect(verdict?.kind).toBe("pass");
    expect(countType(events, "core.permit")).toBe(1);
    expect(countType(events, "core.deny")).toBe(0);
  });

  it("passes note and user-prompt kinds under human-utterance-only", () => {
    for (const kind of ["note", "user-prompt"]) {
      const ep = runFilter(HUO, { store: "episodic", key: "ep:x", value: episode(kind) });
      expect(ep.verdict?.kind).toBe("pass");
      expect(ep.verdict?.cited_clauses).toEqual(["human-utterance-only"]);
      const sem = runFilter(HUO, { store: "semantic", key: "x", value: triples(kind) });
      expect(sem.verdict?.kind).toBe("pass");
    }
  });

  it("rejects any other kind, deny immediately followed by interrupt", () => {
    for (const value of [episode("session-stop"), episode("tool-result")]) {
      const { verdict, events } = runFilter(HUO, { store: "episodic", key: "ep:x", value });
      expect(verdict?.kind).toBe("reject");
      expect(verdict?.cited_clauses).toEqual(["human-utterance-only"]);
      expect(countType(events, "core.permit")).toBe(0);
      expect(countType(events, "core.deny")).toBe(1);
      expect(denyImpliesInterrupt(events)).toBe(true);
      expect(events.some((e) => e.type === "edge.fire" && e.edge === "c5")).toBe(true);
    }
  });

  it("fails closed on unknown kind: old entries without kind are refused", () => {
    // An Episode with no kind field, and a semantic write with no kind
    // triple — the shapes of store entries from before kind existed.
    const ep = runFilter(HUO, { store: "episodic", key: "ep:x", value: episode() });
    expect(ep.verdict?.kind).toBe("reject");
    const sem = runFilter(HUO, { store: "semantic", key: "x", value: triples() });
    expect(sem.verdict?.kind).toBe("reject");
    // …and the same unknown-kind shapes pass under an empty Core.
    expect(
      runFilter(emptyCore(), { store: "semantic", key: "x", value: triples() }).verdict?.kind,
    ).toBe("pass");
  });

  it("throws on a value outside the closed enum instead of interpreting it", () => {
    const core: CoreFile = { values: ["not-a-real-predicate"], goals: [], prose: "" };
    expect(() =>
      runFilter(core, { store: "episodic", key: "ep:x", value: episode("note") }),
    ).toThrow(/cannot interpret core value/);
  });
});

describe("an unknown Core value fails the drain closed", () => {
  it("throws before any store.write; the store file is never created", () => {
    const storeFile = join(tmp("unknown-value"), "store.json");
    expect(() =>
      drainPackets(
        [packet("note.md", "note", "file", "# Note\nhello")],
        storeFile,
        kernel,
        64,
        { values: ["not-a-real-predicate"], goals: [], prose: "" },
      ),
    ).toThrow(/cannot interpret core value/);
    expect(existsSync(storeFile)).toBe(false);
  });
});

describe("the CLI loads the Core before any drain", () => {
  it("a malformed core file aborts the dogfood run with nothing written", async () => {
    const dir = tmp("cli-bad");
    const bufferFile = join(dir, "buffer.jsonl");
    writeFileSync(
      bufferFile,
      JSON.stringify(packet("zz-prompt", "user-prompt", "claude-code", "hello")) + "\n",
    );
    const coreFile = join(dir, "core.json");
    writeFileSync(coreFile, "{ not json");
    const storeFile = join(dir, "store.json");
    const outFile = join(dir, "trace.json");
    let failed = false;
    try {
      await run("bun", [
        TRAY, "--dogfood",
        "--buffer", bufferFile,
        "--inbox", join(dir, "no-inbox"),
        "--store", storeFile,
        "--out", outFile,
        "--core", coreFile,
      ]);
    } catch (err) {
      failed = true;
      expect((err as { stderr?: string }).stderr ?? "").toContain("core file");
    }
    expect(failed).toBe(true); // exit 1: the constitution never loads as empty
    expect(existsSync(storeFile)).toBe(false);
    expect(existsSync(outFile)).toBe(false);
  });

  it("a human-utterance-only dogfood run denies chrome, keeps the human, never writes the Core", async () => {
    const dir = tmp("cli-huo");
    const bufferFile = join(dir, "buffer.jsonl");
    writeFileSync(
      bufferFile,
      JSON.stringify(packet("aa-paste", "tool-result", "claude-code", "# Pasted output\nok")) +
        "\n" +
        JSON.stringify(packet("zz-prompt", "user-prompt", "claude-code", "Refactor the loader.")) +
        "\n",
    );
    const coreFile = join(dir, "core.json");
    const coreBytes = JSON.stringify(HUO, null, 2) + "\n";
    writeFileSync(coreFile, coreBytes);
    const storeFile = join(dir, "store.json");
    const outFile = join(dir, "trace.json");
    const { stdout } = await run("bun", [
      TRAY, "--dogfood",
      "--buffer", bufferFile,
      "--inbox", join(dir, "no-inbox"),
      "--store", storeFile,
      "--out", outFile,
      "--core", coreFile,
    ]); // execFile rejects on non-zero exit, so reaching here is the exit-0 check
    expect(stdout).toContain("(values: human-utterance-only)");
    expect(stdout).toContain("denied by Core");
    expect(stdout).toContain("x aa-paste");
    expect(stdout).toContain("(2 denies)");
    expect(stdout).toContain("safety: PASS");
    expect(stdout).toContain("3. Missing Core clause? Your constitution holds: human-utterance-only.");
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic)).toEqual(["ep:zz-prompt"]);
    expect(store.episodic["ep:zz-prompt"]?.kind).toBe("user-prompt");
    const trace = JSON.parse(readFileSync(outFile, "utf8")) as TraceFile;
    expect(countType(trace.events, "core.deny")).toBe(2);
    expect(denyImpliesInterrupt(trace.events)).toBe(true);
    // The drain read the Core; it must never have written it.
    expect(readFileSync(coreFile, "utf8")).toBe(coreBytes);
  });
});

describe("the sensory boundary is Core-free", () => {
  it("listen.ts keeps the hardcoded empty snapshot and never loads the Core", () => {
    const src = readFileSync(join(HELIX_ROOT, "src", "listen.ts"), "utf8");
    expect(src).toContain("identity: { values: [], goals: [], style: {} }");
    expect(src).not.toContain("core.js");
    expect(src).not.toContain("loadCore");
  });

  it("hook.mjs never touches the Core file, the store, or transcripts", () => {
    const hook = readFileSync(join(HELIX_ROOT, "adapters", "claude-code", "hook.mjs"), "utf8");
    expect(hook).not.toContain("core.json");
    expect(hook).not.toContain("store.write");
    expect(hook).not.toContain("transcript_path");
  });

  it("core.ts itself has no write path at all", () => {
    const src = readFileSync(join(HELIX_ROOT, "src", "core.ts"), "utf8");
    expect(src).not.toContain("writeFileSync");
    expect(src).not.toContain("appendFileSync");
  });
});
