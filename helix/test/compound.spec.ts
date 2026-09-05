import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { emptyCore, loadCore, type CoreFile } from "../src/core.js";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { emptyStore, loadStore, saveStore } from "../src/store.js";
import { drainPackets, readBuffer, runAsk, runTray } from "../src/tray.js";
import type { TraceEvent } from "../src/trace.js";

const kernel = loadKernel();
type StoreWrite = Extract<TraceEvent, { type: "store.write" }>;

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `compound-${name}-`));
}

function packet(id: string, kind: string, text: string): Observation {
  return { id, t: 1756000000000, channel: "file", kind, text };
}

const HUMAN_UTTERANCE_ONLY: CoreFile = {
  values: ["human-utterance-only"],
  goals: ["remember human-authored notes"],
  prose: "Test constitution; prose is never interpreted.",
};

describe("compound drain gates", () => {
  it("partitions quarantine, batching, Core denial, and commits exactly once", () => {
    // Assemble the flagged text at runtime so the repository contains no
    // plausible credential literal or customer hostname. The note trips two
    // rules, which pins note-id deduplication independently of match count.
    const packets = [
      packet(
        "quarantined-note",
        "note",
        ["pass", "word"].join("") +
          " = example-value\n" +
          ["koho", ".", "com"].join(""),
      ),
      packet("denied-result", "tool-result", "# Build output\n\nGenerated compiler details."),
      packet("committed-note", "note", "# Monday note\n\nRemember the release checklist."),
      packet("committed-prompt", "user-prompt", "Summarize the release checklist."),
      packet("later-note", "note", "# Later note\n\nReview after the current batch."),
    ];
    const expected = {
      quarantined: ["quarantined-note"],
      deferred: [],
      denied: ["denied-result"],
      committed: ["committed-note", "committed-prompt", "later-note"],
    };

    // Under a three-slot budget the five packets are perceived in two
    // rounds: [quarantined, denied, committed-note] then [committed-prompt,
    // later-note]. Quarantine happens at the gate of round one, Core
    // denies one item there, and the remaining three commit across both
    // rounds — nothing defers, because the budget bounds a round, not the
    // drain.
    const storeFile = join(tmp("partition"), "store.json");
    const report = drainPackets(
      packets,
      storeFile,
      HUMAN_UTTERANCE_ONLY,
      kernel,
      3,
    );
    const partitions = {
      quarantined: [...new Set(report.quarantined.map((match) => match.note))],
      deferred: report.deferred,
      denied: report.denied,
      committed: report.committed,
    };

    expect(report.quarantined.map((match) => match.rule).sort()).toEqual([
      "credential-assignment",
      "koho-host",
    ]);
    expect(partitions).toEqual(expected);

    const classified = Object.values(partitions).flat();
    expect(new Set(classified).size).toBe(classified.length);
    expect(classified.sort()).toEqual(packets.map((p) => p.id).sort());

    // Independent partition oracle: do not trust TrayReport's classification
    // arrays. What committed must agree exactly across persisted own keys and
    // the trace's non-audit write keys; every other class must be absent.
    const store = loadStore(storeFile);
    const nonAuditWrites = report.trace.events.filter(
      (event): event is StoreWrite =>
        event.type === "store.write" && event.store !== "audit.inbox",
    );
    const expectedEpisodeKeys = expected.committed.map((id) => `ep:${id}`).sort();
    const expectedSemanticKeys = [...expected.committed].sort();
    const expectedWriteKeys = expected.committed
      .flatMap((id) => [`episodic:ep:${id}`, `semantic:${id}`])
      .sort();
    const actualWriteKeys = nonAuditWrites
      .flatMap((event) => event.keys.map((key) => `${event.store}:${key}`))
      .sort();
    const writeKeySet = new Set(actualWriteKeys);

    expect(Object.keys(store.episodic).sort()).toEqual(expectedEpisodeKeys);
    expect(Object.keys(store.semantic).sort()).toEqual(expectedSemanticKeys);
    expect(actualWriteKeys).toEqual(expectedWriteKeys);

    for (const id of expected.committed) {
      expect(Object.hasOwn(store.episodic, `ep:${id}`)).toBe(true);
      expect(Object.hasOwn(store.semantic, id)).toBe(true);
      expect(writeKeySet).toContain(`episodic:ep:${id}`);
      expect(writeKeySet).toContain(`semantic:${id}`);
    }
    for (const id of [
      ...expected.quarantined,
      ...expected.deferred,
      ...expected.denied,
    ]) {
      expect(Object.hasOwn(store.episodic, `ep:${id}`)).toBe(false);
      expect(Object.hasOwn(store.semantic, id)).toBe(false);
      expect(writeKeySet).not.toContain(`episodic:ep:${id}`);
      expect(writeKeySet).not.toContain(`semantic:${id}`);
    }
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
    const rounds = report.trace.events.filter(
      (event) => event.type === "node.enter" && event.graph === "pg-s2w" && event.node === "sensor-normalize",
    );
    expect(rounds).toHaveLength(2);
  });
});

describe("prospective Core enforcement", () => {
  it("keeps an earlier empty-Core commit answerable after the same buffer is denied", () => {
    const remembered = packet(
      "retained-result",
      "tool-result",
      "# Retained result\n\nThe prospective marker remains searchable.",
    );
    const bufferFile = join(tmp("buffer"), "buffer.jsonl");
    writeFileSync(bufferFile, JSON.stringify(remembered) + "\n");
    const storeFile = join(tmp("prospective-store"), "store.json");

    const first = drainPackets(
      readBuffer(bufferFile).packets,
      storeFile,
      emptyCore(),
      kernel,
    );
    expect(first.committed).toEqual([remembered.id]);
    expect(first.denied).toEqual([]);
    const before = readFileSync(storeFile, "utf8");

    const second = drainPackets(
      readBuffer(bufferFile).packets,
      storeFile,
      HUMAN_UTTERANCE_ONLY,
      kernel,
    );
    expect(second.committed).toEqual([]);
    expect(second.denied).toEqual([remembered.id]);
    expect(readFileSync(storeFile, "utf8")).toBe(before);
    expect(loadStore(storeFile).episodic[`ep:${remembered.id}`]?.kind).toBe("tool-result");

    const answer = runAsk("prospective marker", storeFile, HUMAN_UTTERANCE_ONLY, kernel);
    expect(answer.hits[0]?.note).toBe(remembered.id);
    expect(answer.hits[0]?.matched).toEqual(
      expect.arrayContaining(["prospective", "marker"]),
    );
    expect(Object.values(answer.checks).every(Boolean)).toBe(true);
  });
});

describe("inbox determinism with Core", () => {
  it("emits byte-identical traces from the same inbox, store, and non-empty Core", () => {
    const inbox = tmp("inbox");
    writeFileSync(join(inbox, "a-note.md"), "# Release note\n\nThe checklist is ready.\n");
    writeFileSync(join(inbox, "b-note.md"), "# Follow-up\n\nReview the release checklist.\n");

    const coreFile = join(tmp("core"), "core.json");
    writeFileSync(coreFile, JSON.stringify(HUMAN_UTTERANCE_ONLY, null, 2) + "\n");

    const firstStore = join(tmp("first-store"), "store.json");
    const secondStore = join(tmp("second-store"), "store.json");
    saveStore(firstStore, emptyStore());
    saveStore(secondStore, emptyStore());
    expect(readFileSync(secondStore, "utf8")).toBe(readFileSync(firstStore, "utf8"));

    const first = runTray(inbox, firstStore, loadCore(coreFile), kernel);
    const second = runTray(inbox, secondStore, loadCore(coreFile), kernel);
    const traceBytes = (report: typeof first): string =>
      JSON.stringify(report.trace, null, 2) + "\n";

    expect(traceBytes(second)).toBe(traceBytes(first));
    expect(Object.values(first.checks).every(Boolean)).toBe(true);
    expect(Object.values(second.checks).every(Boolean)).toBe(true);
  });
});
