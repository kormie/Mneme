import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { emptyCore, loadCore, type CoreFile } from "../src/core.js";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { emptyStore, loadStore, saveStore } from "../src/store.js";
import { drainPackets, readBuffer, runAsk, runTray } from "../src/tray.js";

const kernel = loadKernel();

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
  it("partitions quarantine, deferral, Core denial, and commits exactly once", () => {
    // Assemble the credential-shaped text at runtime so the repository
    // contains no plausible credential literal.
    const packets = [
      packet("quarantined-note", "note", ["pass", "word"].join("") + " = example-value"),
      packet("denied-result", "tool-result", "# Build output\n\nGenerated compiler details."),
      packet("committed-note", "note", "# Monday note\n\nRemember the release checklist."),
      packet("committed-prompt", "user-prompt", "Summarize the release checklist."),
      packet("deferred-note", "note", "# Later note\n\nReview after the current batch."),
    ];

    // Quarantine happens before the three-slot budget. Of the remaining
    // four packets, one is denied by Core, two commit, and one defers.
    const report = drainPackets(
      packets,
      join(tmp("partition"), "store.json"),
      HUMAN_UTTERANCE_ONLY,
      kernel,
      3,
    );
    const partitions = {
      quarantined: report.quarantined.map((match) => match.note),
      deferred: report.deferred,
      denied: report.denied,
      committed: report.committed,
    };

    expect(partitions).toEqual({
      quarantined: ["quarantined-note"],
      deferred: ["deferred-note"],
      denied: ["denied-result"],
      committed: ["committed-note", "committed-prompt"],
    });

    const classified = Object.values(partitions).flat();
    expect(new Set(classified).size).toBe(classified.length);
    expect(classified.sort()).toEqual(packets.map((p) => p.id).sort());
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
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
