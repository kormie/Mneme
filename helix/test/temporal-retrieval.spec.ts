import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { emptyCore } from "../src/core.js";
import { loadKernel } from "../src/kernel.js";
import { type Observation } from "../src/observation.js";
import { emptyStore, loadStore, saveStore } from "../src/store.js";
import { drainPackets, runAsk, runTray } from "../src/tray.js";
import { countType, validTrace } from "../src/trace.js";

const kernel = loadKernel();
const AS_OF = "2026-09-07";

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `mneme-temporal-${name}-`));
}

function packet(id: string, iso: string, text: string): Observation {
  return { id, t: Date.parse(iso), channel: "claude-code", kind: "user-prompt", text };
}

describe("date-aware retrieval through persisted pg-w2l", () => {
  it("answers pure-temporal and temporal-plus-topic questions without lexical distractors", () => {
    const storeFile = join(tmp("queries"), "store.json");
    drainPackets([
      packet("in-week.md", "2026-09-02T12:00:00Z", "# Release\nCanary completed cleanly"),
      packet("other-topic.md", "2026-09-03T12:00:00Z", "# Planning\nCapacity reviewed"),
      packet("old-words.md", "2026-08-20T12:00:00Z", "# What happened last week\nDeployment postponed"),
    ], storeFile, emptyCore(), kernel);

    const temporal = runAsk("what happened last week?", storeFile, emptyCore(), kernel, AS_OF);
    expect(temporal.hits.map((h) => h.note)).toEqual(["other-topic.md", "in-week.md"]);
    expect(temporal.hits.every((h) => h.score === 0)).toBe(true);
    expect(temporal.observationInterval).toEqual({
      label: "last week",
      startMs: Date.parse("2026-08-31T00:00:00Z"),
      endMs: Date.parse("2026-09-07T00:00:00Z"),
      start: "2026-08-31T00:00:00.000Z",
      end: "2026-09-07T00:00:00.000Z",
    });

    expect(runAsk("what did I write about canary last week?", storeFile, emptyCore(), kernel, AS_OF)
      .hits.map((h) => h.note)).toEqual(["in-week.md"]);
    expect(runAsk("what did I write about deployment last week?", storeFile, emptyCore(), kernel, AS_OF)
      .hits).toEqual([]);
  });

  it("uses a half-open previous UTC week across boundaries and year rollover", () => {
    const storeFile = join(tmp("boundaries"), "store.json");
    drainPackets([
      packet("before.md", "2025-12-21T23:59:59.999Z", "before"),
      packet("start.md", "2025-12-22T00:00:00.000Z", "start"),
      packet("end-minus.md", "2025-12-28T23:59:59.999Z", "end minus"),
      packet("end.md", "2025-12-29T00:00:00.000Z", "end"),
    ], storeFile, emptyCore(), kernel);
    const report = runAsk("what happened last week", storeFile, emptyCore(), kernel, "2026-01-01");
    expect(report.hits.map((h) => h.note)).toEqual(["end-minus.md", "start.md"]);
    expect(report.observationInterval?.start).toBe("2025-12-22T00:00:00.000Z");
    expect(report.observationInterval?.end).toBe("2025-12-29T00:00:00.000Z");
  });

  it("uses Monday boundaries for Saturday and Sunday reference dates", () => {
    const storeFile = join(tmp("weekend"), "store.json");
    for (const asOf of ["2026-09-05", "2026-09-06"]) {
      const report = runAsk("last week", storeFile, emptyCore(), kernel, asOf);
      expect(report.observationInterval?.start).toBe("2026-08-24T00:00:00.000Z");
      expect(report.observationInterval?.end).toBe("2026-08-31T00:00:00.000Z");
    }
  });

  it("preserves inbox mtime and buffer adapter time through semantic conflict reconstruction", () => {
    const inbox = tmp("inbox");
    const note = join(inbox, "file-note.md");
    writeFileSync(note, "# Deploy\nBlue-green rollout\n");
    const mtime = new Date("2026-09-01T10:11:12.000Z");
    utimesSync(note, mtime, mtime);
    const storeFile = join(tmp("sources"), "store.json");
    runTray(inbox, storeFile, emptyCore(), kernel);
    drainPackets([
      packet("buffer-note", "2026-09-04T09:08:07.000Z", "# Buffer\nDeployment checklist"),
    ], storeFile, emptyCore(), kernel);

    const store = loadStore(storeFile);
    expect(store.episodic["ep:file-note.md"]?.observationTimeMs).toBe(mtime.getTime());
    expect(store.semantic["file-note.md"]).toContainEqual({
      s: "file-note.md", p: "observation-time-ms", o: String(mtime.getTime()),
    });
    expect(store.episodic["ep:buffer-note"]?.observationTimeMs)
      .toBe(Date.parse("2026-09-04T09:08:07.000Z"));
  });

  it("keeps legacy records undated, lexical-searchable, and excluded only from bounded results", () => {
    const dir = tmp("legacy");
    const storeFile = join(dir, "store.json");
    const store = emptyStore();
    store.episodic["ep:legacy.md"] = {
      id: "ep:legacy.md", note: "legacy.md", title: "Deployment", headings: [],
    };
    store.semantic["legacy.md"] = [{ s: "legacy.md", p: "mentions", o: "deployment" }];
    store.episodic["ep:irrelevant.md"] = {
      id: "ep:irrelevant.md", note: "irrelevant.md", title: "Groceries", headings: [],
    };
    store.semantic["irrelevant.md"] = [{ s: "irrelevant.md", p: "mentions", o: "groceries" }];
    saveStore(storeFile, store);
    const before = readFileSync(storeFile);

    expect(runAsk("deployment", storeFile, emptyCore(), kernel).hits.map((h) => h.note))
      .toEqual(["legacy.md"]);
    const bounded = runAsk("deployment last week", storeFile, emptyCore(), kernel, AS_OF);
    expect(bounded.hits).toEqual([]);
    expect(bounded.undatedExcluded).toBe(2);
    expect(readFileSync(storeFile)).toEqual(before);
    expect(countType(bounded.trace.events, "store.write")).toBe(0);
    expect(countType(bounded.trace.events, "core.permit")).toBe(0);
  });

  it("treats malformed persisted timestamps as unknown rather than fabricating dates", () => {
    const storeFile = join(tmp("malformed-store"), "store.json");
    const store = emptyStore();
    store.episodic["ep:bad.md"] = {
      id: "ep:bad.md", note: "bad.md", title: "Deployment", headings: [],
      observationTimeMs: null as unknown as number,
    };
    store.semantic["bad.md"] = [{ s: "bad.md", p: "mentions", o: "deployment" }];
    saveStore(storeFile, store);
    const ordinary = runAsk("deployment", storeFile, emptyCore(), kernel);
    expect(ordinary.hits[0]?.observationTimeMs).toBeUndefined();
    const bounded = runAsk("deployment last week", storeFile, emptyCore(), kernel, AS_OF);
    expect(bounded.hits).toEqual([]);
    expect(bounded.undatedExcluded).toBe(1);
  });

  it("rejects missing and malformed reference dates and reports empty intervals", () => {
    const storeFile = join(tmp("errors"), "store.json");
    expect(() => runAsk("last week", storeFile, emptyCore(), kernel)).toThrow(/requires --as-of/);
    for (const bad of ["2026-9-07", "2026-02-30", "noon"]) {
      expect(() => runAsk("last week", storeFile, emptyCore(), kernel, bad)).toThrow(/invalid --as-of/);
    }
    expect(runAsk("last week", storeFile, emptyCore(), kernel, AS_OF).hits).toEqual([]);
    expect(() => runAsk("deployment", storeFile, emptyCore(), kernel, AS_OF))
      .toThrow(/no supported relative period/);
  });

  it("has stable ties, keyed replacement, and byte-identical reports and traces", () => {
    const storeFile = join(tmp("determinism"), "store.json");
    const same = "2026-09-02T00:00:00Z";
    const packets = [packet("b.md", same, "deploy"), packet("a.md", same, "deploy")];
    drainPackets(packets, storeFile, emptyCore(), kernel);
    const bytes = readFileSync(storeFile);
    drainPackets(packets, storeFile, emptyCore(), kernel);
    expect(readFileSync(storeFile)).toEqual(bytes);
    expect(Object.keys(loadStore(storeFile).episodic)).toHaveLength(2);
    const a = runAsk("deploy last week", storeFile, emptyCore(), kernel, AS_OF);
    const b = runAsk("deploy last week", storeFile, emptyCore(), kernel, AS_OF);
    const plain = runAsk("deploy", storeFile, emptyCore(), kernel);
    expect(a.hits.map((h) => h.note)).toEqual(["a.md", "b.md"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.trace.events).toEqual(plain.trace.events);
  });

  it("answers in a new CLI process using only persisted store and query inputs", () => {
    const dir = tmp("process");
    const storeFile = join(dir, "store.json");
    const traceFile = join(dir, "ask.json");
    drainPackets([
      packet("release.md", "2026-09-02T12:00:00Z", "# Release\nDeployment canary"),
    ], storeFile, emptyCore(), kernel);
    const before = readFileSync(storeFile);
    const result = spawnSync(
      process.execPath,
      ["src/tray.ts", "--ask", "deployment last week", "--as-of", AS_OF,
        "--store", storeFile, "--out", traceFile, "--core", join(dir, "no-core.json")],
      { cwd: join(import.meta.dir, ".."), encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("release.md");
    expect(result.stdout).toContain("observation time: [2026-08-31T00:00:00.000Z, 2026-09-07T00:00:00.000Z)");
    expect(result.stdout).toContain("observed (adapter clock): 2026-09-02T12:00:00.000Z");
    expect(result.stdout).toContain("(release.md, mentions, deployment)");
    expect(readFileSync(storeFile)).toEqual(before);
    const trace = JSON.parse(readFileSync(traceFile, "utf8")) as { events: { type: string }[] };
    expect(trace.events.some((event) => event.type === "store.write")).toBe(false);
    expect(trace.events.some((event) => event.type === "core.permit")).toBe(false);
    expect(new Set(trace.events.map((event) => event.type))).toEqual(
      new Set(["node.enter", "node.exit", "edge.fire", "store.read"]),
    );
    expect(validTrace(kernel, trace.events as Parameters<typeof validTrace>[1])).toBe(true);
  });

  it("rejects --dogfood --as-of before writing anything", () => {
    const dir = tmp("dogfood-as-of");
    const storeFile = join(dir, "store.json");
    const traceFile = join(dir, "trace.json");
    const result = spawnSync(
      process.execPath,
      ["src/tray.ts", "--dogfood", "--as-of", AS_OF,
        "--store", storeFile, "--out", traceFile, "--core", join(dir, "no-core.json")],
      { cwd: join(import.meta.dir, ".."), encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--as-of is only valid with --ask");
    expect(existsSync(storeFile)).toBe(false);
    expect(existsSync(traceFile)).toBe(false);
  });

  it("reports when CLI display truncates a temporal result", () => {
    const dir = tmp("display-cap");
    const storeFile = join(dir, "store.json");
    drainPackets(
      Array.from({ length: 6 }, (_, i) =>
        packet(`note-${i}.md`, `2026-09-0${i + 1}T00:00:00Z`, `item ${i}`),
      ),
      storeFile,
      emptyCore(),
      kernel,
    );
    const result = spawnSync(
      process.execPath,
      ["src/tray.ts", "--ask", "what happened last week", "--as-of", AS_OF,
        "--store", storeFile, "--out", join(dir, "trace.json"),
        "--core", join(dir, "no-core.json")],
      { cwd: join(import.meta.dir, ".."), encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("… and 1 more note(s) in this result");
  });
});
