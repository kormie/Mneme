import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { emptyStore, loadStore, saveStore, type Episode } from "../src/store.js";
import { countType } from "../src/trace.js";
import { drainPackets, runAsk } from "../src/tray.js";

const kernel = loadKernel();
const directory = mkdtempSync(join(tmpdir(), "mneme-recall-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function packet(id: string, text: string, t = 1000): Observation {
  return { id, text, t, channel: "file", kind: "note" };
}

function ingest(name: string, packets: Observation[]): string {
  const file = join(directory, `${name}.json`);
  drainPackets(packets, file, kernel);
  return file;
}

describe("source-backed recall", () => {
  it("persists the exact bounded excerpt and source time through syntactic triples", () => {
    const text = "# Café notes\r\n\r\nA short source quotation.\n" + "body ".repeat(300);
    const file = join(directory, "source.json");
    const report = drainPackets([packet("cafe", text, 1725123456789)], file, kernel);
    const episode = loadStore(file).episodic["ep:cafe"]!;
    expect(episode.excerpt).toBe(text.slice(0, 1200));
    expect(episode.excerpt).toHaveLength(1200);
    expect(episode.observedAt).toBe(1725123456789);
    expect(report.triples).toContainEqual({ s: "cafe", p: "excerpt", o: episode.excerpt! });
    expect(report.triples).toContainEqual({ s: "cafe", p: "observedAt", o: "1725123456789" });
    expect(report.trace.events).toContainEqual({ type: "edge.fire", edge: "w4", kind: "data" });
    expect(countType(report.trace.events, "core.permit")).toBe(2);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);

    const hit = runAsk("cafe", file, kernel).hits[0]!;
    expect(hit.excerpt).toBe(episode.excerpt);
    expect(hit.observedAt).toBe(episode.observedAt);
    expect(hit.channel).toBe("file");
  });

  it("keeps two-letter terms searchable even beyond the excerpt", () => {
    const file = ingest("acronyms", [
      packet("build", "# Build\n\n" + "padding ".repeat(200) + " CI failed after the PR merged."),
      packet("home", "# Home\n\nBuy apples."),
    ]);
    expect(runAsk("what is the CI issue?", file, kernel).hits.map((hit) => hit.note)).toEqual(["build"]);
    expect(runAsk("PR", file, kernel).hits[0]?.matched).toContain("pr");
    expect(runAsk('"CI failed"', file, kernel).hits).toEqual([]);
  });

  it("requires every quoted phrase in source wording, without cross-field matches", () => {
    const file = ingest("phrases", [
      packet("exact", "# Décision\n\nWe agreed to book the café for Friday. Share the seating plan."),
      packet("unordered", "# Alternative\n\nThe café can book a Friday meeting. We have a plan for seating."),
      packet("substring", "# Crook the cafe\n\nCheck the meeting."),
      packet("fields", "# Book the\n\n" + "padding ".repeat(200) + "\n## Café\n"),
    ]);
    expect(runAsk('"book the cafe"', file, kernel).hits.map((hit) => hit.note)).toEqual(["exact"]);
    expect(runAsk('"book the cafe" "seating plan"', file, kernel).hits.map((hit) => hit.note)).toEqual(["exact"]);
    expect(runAsk('"book the cafe" "no such phrase"', file, kernel).hits).toEqual([]);
    expect(runAsk('"we have"', file, kernel).hits.map((hit) => hit.note)).toEqual(["unordered"]);
    expect(runAsk('“DÉCISION”', file, kernel).hits.map((hit) => hit.note)).toEqual(["exact"]);
  });

  it("ranks term coverage before prominence and breaks ties by source id", () => {
    const file = ingest("ranking", [
      packet("partial", "# Garden garden garden\n\nGarden garden."),
      packet("body-b", "# Monday\n\nGarden irrigation needs repairs."),
      packet("body-a", "# Monday\n\nGarden irrigation needs repairs."),
      packet("title", "# Garden irrigation\n\nReview the plan."),
    ]);
    const report = runAsk("garden irrigation", file, kernel);
    expect(report.hits.map((hit) => hit.note)).toEqual(["title", "body-a", "body-b", "partial"]);
    expect(report.hits[2]!.score).toBeGreaterThan(report.hits[3]!.score);
    expect(runAsk("garden irrigation", file, kernel).hits).toEqual(report.hits);
  });

  it("does not retain quarantined source prose or timestamps", () => {
    const sensitive = ["pass", "word"].join("") + " = not-for-memory";
    const file = ingest("quarantined", [packet("private", `# Login\n${sensitive}`)]);
    expect(loadStore(file).episodic).toEqual({});
    expect(readFileSync(file, "utf8")).not.toContain(sensitive);
    expect(runAsk("", file, kernel, { recent: true }).hits).toEqual([]);
  });

  it("omits an out-of-range adapter clock instead of inventing a usable date", () => {
    const file = ingest("unknown-time", [packet("unknown", "# Schedule\n\nClock unavailable.", 1e20)]);
    expect(loadStore(file).episodic["ep:unknown"]?.observedAt).toBeUndefined();
    expect(runAsk("clock", file, kernel).hits[0]?.observedAt).toBeUndefined();
  });
});

describe("daily recall filters", () => {
  const file = join(directory, "timeline.json");
  const episodes: Episode[] = [
    { id: "ep:legacy", note: "legacy", title: "Garden", headings: [] },
    { id: "ep:old", note: "old", title: "Garden", headings: [], observedAt: 1000 },
    { id: "ep:new-b", note: "new-b", title: "Garden", headings: [], observedAt: 3000 },
    { id: "ep:new-a", note: "new-a", title: "Garden", headings: [], observedAt: 3000 },
    { id: "ep:middle", note: "middle", title: "Garden", headings: [], observedAt: 2000 },
  ];
  const store = emptyStore();
  for (const episode of episodes) store.episodic[episode.id] = episode;
  saveStore(file, store);

  it("lists recent memory deterministically with legacy unknown times last", () => {
    const report = runAsk("", file, kernel, { recent: true });
    expect(report.hits.map((hit) => hit.note)).toEqual(["new-a", "new-b", "middle", "old", "legacy"]);
    expect(runAsk("", file, kernel).hits).toEqual([]);
    expect(report.hits[4]?.channel).toBe("file");
    expect(report.hits[4]?.excerpt).toBeUndefined();
  });

  it("filters by inclusive observed times before applying a result limit", () => {
    expect(runAsk("garden", file, kernel, { since: 2000, until: 3000, recent: true, limit: 2 })
      .hits.map((hit) => hit.note)).toEqual(["new-a", "new-b"]);
    expect(runAsk("garden", file, kernel, { since: 2000, until: 2000 })
      .hits.map((hit) => hit.note)).toEqual(["middle"]);
    expect(runAsk("garden", file, kernel, { until: 1000 }).hits.map((hit) => hit.note)).toEqual(["old"]);
    expect(runAsk("unrelated", file, kernel, { recent: true }).hits).toEqual([]);
  });

  it("carries filters through the declared read path without changing the store", () => {
    const before = readFileSync(file, "utf8");
    const report = runAsk("garden", file, kernel, { recent: true, since: 2000, limit: 1 });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
    expect(countType(report.trace.events, "store.write")).toBe(0);
    expect(countType(report.trace.events, "core.permit")).toBe(0);
    expect(report.trace.events.filter((event) => event.type === "node.enter")
      .map((event) => event.node)).toEqual(["query", "hybrid", "rerank", "inject"]);
    expect(report.trace.events.filter((event) => event.type === "edge.fire")
      .map((event) => event.edge)).toEqual(["w9", "w10", "w11"]);
  });

  it("rejects invalid filters and limits with actionable errors", () => {
    expect(() => runAsk("garden", file, kernel, { since: NaN })).toThrow(/since/);
    expect(() => runAsk("garden", file, kernel, { until: Infinity })).toThrow(/until/);
    expect(() => runAsk("garden", file, kernel, { since: 3000, until: 1000 })).toThrow(/since/);
    for (const limit of [0, -1, 1.5, Infinity]) {
      expect(() => runAsk("garden", file, kernel, { limit })).toThrow(/positive integer/);
    }
  });
});
