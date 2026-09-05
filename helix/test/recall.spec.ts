import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyCore } from "../src/core.js";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { emptyStore, loadStore, saveStore, type Episode } from "../src/store.js";
import { countType } from "../src/trace.js";
import { drainPackets, runAsk, type DailyAskOptions } from "../src/tray.js";

const kernel = loadKernel();
const directory = mkdtempSync(join(tmpdir(), "mneme-recall-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function packet(id: string, text: string, t = 1000): Observation {
  return { id, text, t, channel: "file", kind: "note" };
}

function ingest(name: string, packets: Observation[]): string {
  const file = join(directory, `${name}.json`);
  drainPackets(packets, file, emptyCore(), kernel);
  return file;
}

function ask(question: string, file: string, options: DailyAskOptions = {}) {
  return runAsk(question, file, emptyCore(), kernel, undefined, undefined, options);
}

describe("source-backed recall", () => {
  it("persists the exact bounded excerpt and source time through syntactic triples", () => {
    const text = "# Café notes\r\n\r\nA short source quotation.\n" + "body ".repeat(300);
    const file = join(directory, "source.json");
    const report = drainPackets([packet("cafe", text, 1725123456789)], file, emptyCore(), kernel);
    const episode = loadStore(file).episodic["ep:cafe"]!;
    expect(episode.excerpt).toBe(text.slice(0, 1200));
    expect(episode.excerpt).toHaveLength(1200);
    expect(episode.observationTimeMs).toBe(1725123456789);
    expect(report.triples).toContainEqual({ s: "cafe", p: "excerpt", o: episode.excerpt! });
    expect(report.triples).toContainEqual({ s: "cafe", p: "observation-time-ms", o: "1725123456789" });
    expect(report.trace.events).toContainEqual({ type: "edge.fire", edge: "w4", kind: "data" });
    expect(countType(report.trace.events, "core.permit")).toBe(2);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);

    const hit = ask("cafe", file).hits[0]!;
    expect(hit.excerpt).toBe(episode.excerpt);
    expect(hit.observationTimeMs).toBe(episode.observationTimeMs);
    expect(hit.channel).toBe("file");
  });

  it("keeps two-letter terms searchable even beyond the excerpt", () => {
    const file = ingest("acronyms", [
      packet("build", "# Build\n\n" + "padding ".repeat(200) + " CI failed after the PR merged."),
      packet("home", "# Home\n\nBuy apples."),
    ]);
    expect(ask("what is the CI issue?", file).hits.map((hit) => hit.note)).toEqual(["build"]);
    expect(ask("PR", file).hits[0]?.matched).toContain("pr");
    expect(ask('"CI failed"', file).hits[0]?.phrases).toEqual({ "ci failed": "all-words" });
  });

  it("preserves all-word phrase fallback while returning exact source excerpts", () => {
    const file = ingest("phrases", [
      packet("exact", "# Décision\n\nWe agreed to book the café for Friday. Share the seating plan."),
      packet("unordered", "# Alternative\n\nThe café can book a Friday meeting. We have a plan for seating."),
      packet("substring", "# Crook the cafe\n\nCheck the meeting."),
      packet("fields", "# Book the\n\n" + "padding ".repeat(200) + "\n## Café\n"),
    ]);
    expect(ask('"book the cafe"', file).hits.map((hit) => hit.note)).toEqual(["fields", "exact", "unordered"]);
    const both = ask('"book the cafe" "seating plan"', file);
    expect(both.hits.map((hit) => hit.note)).toEqual(["exact", "unordered"]);
    expect(both.hits[0]?.phrases).toEqual({ "book the cafe": "all-words", "seating plan": "all-words" });
    expect(both.hits[0]?.excerpt).toContain("book the café");
    expect(ask('"book the cafe" "no such phrase"', file).hits).toEqual([]);
    expect(ask('"we have"', file).hits).toEqual([]);
    expect(ask('“DÉCISION”', file).hits.map((hit) => hit.note)).toEqual(["exact"]);
  });

  it("preserves strong title weighting and deterministic tie ordering", () => {
    const file = ingest("ranking", [
      packet("partial", "# Garden garden garden\n\nGarden garden."),
      packet("body-b", "# Monday\n\nGarden irrigation needs repairs."),
      packet("body-a", "# Monday\n\nGarden irrigation needs repairs."),
      packet("title", "# Garden irrigation\n\nReview the plan."),
    ]);
    const report = ask("garden irrigation", file);
    expect(report.hits.map((hit) => hit.note)).toEqual(["title", "body-a", "body-b", "partial"]);
    expect(report.hits.map((hit) => hit.score)).toEqual([4, 2, 2, 2]);
    expect(ask("garden irrigation", file).hits).toEqual(report.hits);
  });

  it("does not retain quarantined source prose or timestamps", () => {
    const sensitive = ["pass", "word"].join("") + " = not-for-memory";
    const file = ingest("quarantined", [packet("private", `# Login\n${sensitive}`)]);
    expect(loadStore(file).episodic).toEqual({});
    expect(readFileSync(file, "utf8")).not.toContain(sensitive);
    expect(ask("", file, { recent: true }).hits).toEqual([]);
  });

  it("omits an out-of-range adapter clock instead of inventing a usable date", () => {
    const file = ingest("unknown-time", [packet("unknown", "# Schedule\n\nClock unavailable.", 1e20)]);
    expect(loadStore(file).episodic["ep:unknown"]?.observationTimeMs).toBeUndefined();
    expect(ask("clock", file).hits[0]?.observationTimeMs).toBeUndefined();
  });
});

describe("daily recall filters", () => {
  const file = join(directory, "timeline.json");
  const episodes: Episode[] = [
    { id: "ep:legacy", note: "legacy", title: "Garden", headings: [] },
    { id: "ep:old", note: "old", title: "Garden", headings: [], observationTimeMs: 1000 },
    { id: "ep:new-b", note: "new-b", title: "Garden", headings: [], observationTimeMs: 3000 },
    { id: "ep:new-a", note: "new-a", title: "Garden", headings: [], observationTimeMs: 3000 },
    { id: "ep:middle", note: "middle", title: "Garden", headings: [], observationTimeMs: 2000 },
  ];
  const store = emptyStore();
  for (const episode of episodes) store.episodic[episode.id] = episode;
  saveStore(file, store);

  it("lists recent memory deterministically with legacy unknown times last", () => {
    const report = ask("", file, { recent: true });
    expect(report.hits.map((hit) => hit.note)).toEqual(["new-a", "new-b", "middle", "old", "legacy"]);
    expect(ask("", file).hits).toEqual([]);
    expect(report.hits[4]?.channel).toBe("file");
    expect(report.hits[4]?.excerpt).toBeUndefined();
  });

  it("filters by inclusive observed times before applying a result limit", () => {
    expect(ask("garden", file, { since: 2000, until: 3000, recent: true, limit: 2 })
      .hits.map((hit) => hit.note)).toEqual(["new-a", "new-b"]);
    expect(ask("garden", file, { since: 2000, until: 2000 })
      .hits.map((hit) => hit.note)).toEqual(["middle"]);
    expect(ask("garden", file, { until: 1000 }).hits.map((hit) => hit.note)).toEqual(["old"]);
    expect(ask("unrelated", file, { recent: true }).hits).toEqual([]);
  });

  it("intersects numeric filters with the existing temporal question parser", () => {
    const result = runAsk("garden on 1970-01-01", file, emptyCore(), kernel, undefined, undefined,
      { since: 2000, until: 2000, limit: 1 });
    expect(result.hits.map((hit) => hit.note)).toEqual(["middle"]);
    expect(result.observationInterval?.startMs).toBe(0);
    expect(result.undatedExcluded).toBe(1);
  });

  it("carries filters through the declared read path without changing the store", () => {
    const before = readFileSync(file, "utf8");
    const report = ask("garden", file, { recent: true, since: 2000, limit: 1 });
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
    expect(() => ask("garden", file, { since: NaN })).toThrow(/since/);
    expect(() => ask("garden", file, { until: Infinity })).toThrow(/until/);
    expect(() => ask("garden", file, { since: 3000, until: 1000 })).toThrow(/since/);
    for (const limit of [0, -1, 1.5, Infinity]) {
      expect(() => ask("garden", file, { limit })).toThrow(/positive integer/);
    }
  });
});
