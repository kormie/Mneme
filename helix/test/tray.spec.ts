import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { emptyCore } from "../src/core.js";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { drainPackets, extractPhrases, runAsk, runTray } from "../src/tray.js";
import { loadStore, saveStore } from "../src/store.js";
import { commitAfterPermit, countType, validTrace, type TraceEvent } from "../src/trace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../fixtures/tray");
const kernel = loadKernel();

const FIXTURE_NOTES = [
  "ci-failure.md",
  "follow-up.md",
  "git-day.md",
  "pr-review.md",
  "standup.md",
];

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `tray-${name}-`));
}

describe("desk-tray ingest on the clean fixtures", () => {
  const storeFile = join(tmp("store"), "tray.json");
  const report = runTray(FIXTURES, storeFile, emptyCore(), kernel);
  const events = report.trace.events;

  it("consumes the fixture notes with nothing quarantined", () => {
    expect(report.notes).toEqual(FIXTURE_NOTES);
    expect(report.quarantined).toEqual([]);
    expect(report.committed).toEqual(FIXTURE_NOTES);
    expect(report.episodes).toHaveLength(FIXTURE_NOTES.length);
  });

  it("emits a valid mneme.trace/v1 stream", () => {
    expect(report.trace.trace).toBe("mneme.trace/v1");
    expect(report.trace.spec).toBe("mneme.spec/0.10");
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });

  it("pairs every non-audit store.write with its own preceding permit", () => {
    const ltmWrites = events.filter(
      (e) => e.type === "store.write" && e.store !== "audit.inbox",
    );
    expect(ltmWrites.length).toBe(FIXTURE_NOTES.length * 2); // episodic + semantic per note
    expect(report.permitPairs).toHaveLength(ltmWrites.length);
    expect(countType(events, "core.permit")).toBe(ltmWrites.length);
    for (const p of report.permitPairs) expect(p.permitIndex).toBeGreaterThanOrEqual(0);
    const permitIndices = report.permitPairs.map((p) => p.permitIndex);
    expect(new Set(permitIndices).size).toBe(permitIndices.length);
  });

  it("writes audit.inbox exactly once, permit-exempt, after prompt.audit", () => {
    const auditWrite = events.findIndex(
      (e) => e.type === "store.write" && e.store === "audit.inbox",
    );
    const promptAudit = events.findIndex((e) => e.type === "prompt.audit");
    expect(promptAudit).toBeGreaterThanOrEqual(0);
    expect(auditWrite).toBeGreaterThan(promptAudit);
  });

  it("never installs, acks, mints, or acts (negative surface stays quiet)", () => {
    for (const t of ["twin.install", "steward.ack", "cap.mint", "cap.revoke", "twin.action", "partition.propose", "core.deny"] as const) {
      expect(countType(events, t), t).toBe(0);
    }
    for (const e of events) {
      if (e.type === "store.read" || e.type === "store.write") {
        expect(e.twin, "twin id without twin.install").toBeUndefined();
      }
    }
  });

  it("is deterministic across runs from the same starting store", () => {
    const again = runTray(FIXTURES, join(tmp("det"), "tray.json"), emptyCore(), kernel);
    expect(again.trace).toEqual(report.trace);
  });

  it("tampered traces fail the untrusted mirrors (amortized permit, ghost edge)", () => {
    const firstPermit = events.findIndex((e) => e.type === "core.permit");
    const amortized = events.filter((_, i) => i !== firstPermit);
    expect(commitAfterPermit(amortized)).toBe(false);

    const ghost: TraceEvent[] = [...events, { type: "edge.fire", edge: "zz99", kind: "data" }];
    expect(validTrace(kernel, ghost)).toBe(false);
  });
});

describe("persistence and retrieval", () => {
  const storeFile = join(tmp("mem"), "tray.json");
  runTray(FIXTURES, storeFile, emptyCore(), kernel);

  it("persists episodes and triples to the local store, idempotently", () => {
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic).sort()).toEqual(
      FIXTURE_NOTES.map((n) => `ep:${n}`).sort(),
    );
    const again = runTray(FIXTURES, storeFile, emptyCore(), kernel); // re-ingest: replace, not duplicate
    expect(loadStore(storeFile)).toEqual(store);
    // The digest knows nothing changed — and every write still paid a permit.
    expect(again.unchanged).toEqual(FIXTURE_NOTES);
    expect(again.fresh).toEqual([]);
    expect(again.replaced).toEqual([]);
    expect(again.permitPairs).toHaveLength(FIXTURE_NOTES.length * 2);
  });

  it("classifies a first drain as new and an edited re-delivery as replaced", () => {
    const sf = join(tmp("classify"), "tray.json");
    const t = 1756000000000;
    const first = drainPackets([
      { id: "cc-a", t, channel: "claude-code", kind: "user-prompt", text: "Sort the loader." },
      { id: "cc-b", t, channel: "claude-code", kind: "user-prompt", text: "Test the gate." },
    ], sf, emptyCore(), kernel);
    expect(first.fresh).toEqual(["cc-a", "cc-b"]);
    expect(first.unchanged).toEqual([]);
    const second = drainPackets([
      { id: "cc-a", t, channel: "claude-code", kind: "user-prompt", text: "Sort the loader." },
      { id: "cc-b", t: t + 1, channel: "claude-code", kind: "user-prompt", text: "Test the gate again." },
      { id: "cc-c", t, channel: "claude-code", kind: "user-prompt", text: "New prompt." },
    ], sf, emptyCore(), kernel);
    expect(second.unchanged).toEqual(["cc-a"]);
    expect(second.replaced).toEqual(["cc-b"]);
    expect(second.fresh).toEqual(["cc-c"]);
    expect(second.committed).toEqual(["cc-a", "cc-b", "cc-c"]);
  });

  it("answers a question over the store via the declared read path", () => {
    const report = runAsk("what did I write about Jordan?", storeFile, emptyCore(), kernel);
    expect(report.storeNotes).toBe(FIXTURE_NOTES.length);
    expect(report.hits[0]?.note).toBe("follow-up.md");
    expect(report.hits[0]?.matched).toContain("jordan");
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
    // Read path is read-only: no writes, no permits needed or emitted.
    expect(countType(report.trace.events, "store.write")).toBe(0);
    expect(countType(report.trace.events, "core.permit")).toBe(0);
    const reads = report.trace.events.filter((e) => e.type === "store.read");
    expect(reads.map((r) => r.type === "store.read" && r.store).sort()).toEqual([
      "episodic",
      "semantic",
    ]);
  });

  it("ranks heading matches and stays deterministic", () => {
    const a = runAsk("blockers", storeFile, emptyCore(), kernel);
    expect(a.hits[0]?.note).toBe("standup.md");
    expect(runAsk("blockers", storeFile, emptyCore(), kernel).trace).toEqual(a.trace);
  });

  it("finds body prose via the capped keyword triples", () => {
    expect(runAsk("runbook", storeFile, emptyCore(), kernel).hits[0]?.note).toBe("ci-failure.md");
    expect(runAsk("consume-once permits", storeFile, emptyCore(), kernel).hits[0]?.note).toBe("standup.md");
  });

  it("folds accents so plain-ASCII queries find French notes", () => {
    const inbox = tmp("fr");
    writeFileSync(
      join(inbox, "reunion.md"),
      "# Réunion d'équipe\n\n## Décisions\n\n- prochaine étape lundi matin\n",
    );
    const sf = join(tmp("frstore"), "tray.json");
    runTray(inbox, sf, emptyCore(), kernel);
    expect(runAsk("equipe", sf, emptyCore(), kernel).hits[0]?.note).toBe("reunion.md");
    expect(runAsk("Décisions", sf, emptyCore(), kernel).hits[0]?.note).toBe("reunion.md");
    expect(runAsk("etape", sf, emptyCore(), kernel).hits[0]?.note).toBe("reunion.md");
  });

  it("answers gracefully over an empty store", () => {
    const report = runAsk("anything", join(tmp("empty"), "none.json"), emptyCore(), kernel);
    expect(report.storeNotes).toBe(0);
    expect(report.hits).toEqual([]);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });

  it("refuses a corrupt store instead of silently wiping memory", () => {
    const file = join(tmp("corrupt"), "tray.json");
    writeFileSync(file, "{ not json");
    expect(() => runTray(FIXTURES, file, emptyCore(), kernel)).toThrow();
    writeFileSync(file, JSON.stringify({ store: "something-else" }));
    expect(() => runTray(FIXTURES, file, emptyCore(), kernel)).toThrow(/unrecognized/);
    expect(readFileSync(file, "utf8")).toContain("something-else"); // untouched
  });

  it("drains a backlog larger than the working-memory budget in batches, committing everything", () => {
    // Working memory is a declared budget per pg-s2w invocation, so a
    // backlog of 5 under a budget of 2 is perceived in three rounds of
    // the same declared graphs — nothing past the budget is dropped, and
    // nothing is reordered. pg-audit runs once, after the last round.
    const batchedStore = join(tmp("budget"), "tray.json");
    const report = runTray(FIXTURES, batchedStore, emptyCore(), kernel, 2);
    expect(report.committed).toEqual(FIXTURE_NOTES);
    expect(report.deferred).toEqual([]);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
    const events = report.trace.events;
    const rounds = events.filter(
      (e) => e.type === "node.enter" && e.graph === "pg-s2w" && e.node === "sensor-normalize",
    );
    expect(rounds).toHaveLength(3); // ceil(5 / 2)
    expect(countType(events, "prompt.audit")).toBe(1);
    const promptAudit = events.findIndex((e) => e.type === "prompt.audit");
    const lastLtmWrite = events.map((e) => e.type === "store.write" && e.store !== "audit.inbox")
      .lastIndexOf(true);
    expect(lastLtmWrite).toBeLessThan(promptAudit);
    expect(report.permitPairs).toHaveLength(FIXTURE_NOTES.length * 2);
    // The memory that results is exactly what one unbatched round writes.
    const wholeStore = join(tmp("budget-whole"), "tray.json");
    runTray(FIXTURES, wholeStore, emptyCore(), kernel);
    expect(loadStore(batchedStore)).toEqual(loadStore(wholeStore));
  });

  it("refuses a non-positive working-memory budget", () => {
    expect(() => runTray(FIXTURES, join(tmp("budget-zero"), "tray.json"), emptyCore(), kernel, 0))
      .toThrow(/positive integer/);
  });
});

describe("retrieval ranking", () => {
  const t0 = Date.parse("2026-09-01T12:00:00Z");
  function note(id: string, t: number, text: string): Observation {
    return { id, t, channel: "file", kind: "note", text };
  }

  it("counts a word in the title or a heading double, and ranks that above recency", () => {
    const sf = join(tmp("weights"), "tray.json");
    drainPackets([
      note("body.md", t0 + 1000, "# Tuesday\n\nWe discussed the canary rollout at length, canary canary."),
      note("heading.md", t0, "# Release\n\n## Canary\n\n- go/no-go at noon"),
    ], sf, emptyCore(), kernel);
    const r = runAsk("canary", sf, emptyCore(), kernel);
    expect(r.hits.map((h) => [h.note, h.score])).toEqual([["heading.md", 2], ["body.md", 1]]);
    expect(r.hits[0]?.via).toEqual({ canary: "canary" });
  });

  it("matches a query word as a prefix of a stored word from four characters up", () => {
    const sf = join(tmp("prefix"), "tray.json");
    drainPackets([note("d.md", t0, "# Plan\n\nThe deployment checklist is ready.")], sf, emptyCore(), kernel);
    const hit = runAsk("deploy", sf, emptyCore(), kernel).hits[0];
    expect(hit?.note).toBe("d.md");
    expect(hit?.matched).toEqual(["deploy"]);
    expect(hit?.via).toEqual({ deploy: "deployment" });
    expect(runAsk("dep", sf, emptyCore(), kernel).hits).toEqual([]);
    expect(runAsk("plan", sf, emptyCore(), kernel).hits[0]?.score).toBe(2); // exact, in the title
  });

  it("breaks score ties by newest observation, undated last, then note id — for every ask", () => {
    const sf = join(tmp("recency"), "tray.json");
    drainPackets([
      note("older.md", t0, "# Flaky test\n\nstill flapping"),
      note("newer.md", t0 + 60_000, "# Flaky test\n\nfixed the seed"),
      note("same-a.md", t0 + 120_000, "# Flaky test\n\nnoted"),
      note("same-b.md", t0 + 120_000, "# Flaky test\n\nnoted"),
    ], sf, emptyCore(), kernel);
    const store = loadStore(sf);
    store.episodic["ep:undated.md"] = { id: "ep:undated.md", note: "undated.md", title: "Flaky test", headings: [] };
    store.semantic["undated.md"] = [{ s: "undated.md", p: "titled", o: "Flaky test" }];
    saveStore(sf, store);
    const r = runAsk("flaky", sf, emptyCore(), kernel);
    expect(r.hits.map((h) => h.note)).toEqual(["same-a.md", "same-b.md", "newer.md", "older.md", "undated.md"]);
    expect(runAsk("flaky", sf, emptyCore(), kernel).hits).toEqual(r.hits);
  });

  it("finds a note by 'week' or 'last' as content: period words are excised, not stopwords", () => {
    const sf = join(tmp("week"), "tray.json");
    drainPackets([note("wk.md", t0, "# Week planning\n\nthe last item first")], sf, emptyCore(), kernel);
    expect(runAsk("week", sf, emptyCore(), kernel).hits[0]?.score).toBe(2);
    expect(runAsk("last item", sf, emptyCore(), kernel).hits[0]?.matched).toEqual(["last", "item"]);
    // …while "last week" as a period still never becomes a lexical requirement.
    expect(runAsk("planning last week", sf, emptyCore(), kernel, "2026-09-07").hits[0]?.matched).toEqual(["planning"]);
  });

  it("never matches provenance triples: channel and kind words are not content", () => {
    const sf = join(tmp("metadata"), "tray.json");
    drainPackets([
      { id: "cc-1", t: t0, channel: "claude-code", kind: "user-prompt", text: "Rename the loader." },
      note("n.md", t0, "# Notes\n\nA prompt about a file."),
    ], sf, emptyCore(), kernel);
    expect(runAsk("claude code user", sf, emptyCore(), kernel).hits).toEqual([]);
    // …but the same words as real content still match.
    expect(runAsk("prompt", sf, emptyCore(), kernel).hits.map((h) => h.note)).toEqual(["n.md"]);
    expect(runAsk("what did I ask about the loader", sf, emptyCore(), kernel).hits.map((h) => h.note)).toEqual(["cc-1"]);
  });
});

describe("quoted phrases", () => {
  const t0 = Date.parse("2026-09-01T12:00:00Z");
  function note(id: string, t: number, text: string): Observation {
    return { id, t, channel: "file", kind: "note", text };
  }

  it("requires every word of the phrase, and prefers adjacency in a heading over scattered words", () => {
    const sf = join(tmp("phrase"), "tray.json");
    drainPackets([
      note("scattered.md", t0 + 1000, "# Tuesday\n\nThe review of the code took an hour; code review again."),
      note("heading.md", t0, "# Process\n\n## Code review\n\n- two approvals"),
      note("partial.md", t0 + 2000, "# Wednesday\n\nThe review went well."),
    ], sf, emptyCore(), kernel);
    const r = runAsk('"code review"', sf, emptyCore(), kernel);
    expect(r.hits.map((h) => h.note)).toEqual(["heading.md", "scattered.md"]);
    expect(r.hits[0]?.phrases).toEqual({ "code review": "adjacent" });
    expect(r.hits[1]?.phrases).toEqual({ "code review": "all-words" });
    expect(r.hits[0]!.score).toBeGreaterThan(r.hits[1]!.score);
    expect(r.hits[0]?.matched).toEqual(["code", "review"]);
    // Extra unquoted words stay any-match on top of the required phrase.
    const both = runAsk('approvals "code review"', sf, emptyCore(), kernel);
    expect(both.hits.map((h) => h.note)).toEqual(["heading.md", "scattered.md"]);
    expect(both.hits[0]?.matched).toEqual(["approvals", "code", "review"]);
  });

  it("treats unbalanced quotes as plain text, and a stopword-only phrase as adjacency-only", () => {
    const sf = join(tmp("quotes"), "tray.json");
    drainPackets([note("n.md", t0, "# Notes\n\nthe review went well")], sf, emptyCore(), kernel);
    expect(runAsk('review "went', sf, emptyCore(), kernel).hits[0]?.matched).toEqual(["review", "went"]);
    // "the" has no content words and is not in the title: no hit at all.
    expect(runAsk('"the" review', sf, emptyCore(), kernel).hits).toEqual([]);
    expect(runAsk('"went well"', sf, emptyCore(), kernel).hits[0]?.phrases).toEqual({ "went well": "all-words" });
    expect(runAsk('"went badly"', sf, emptyCore(), kernel).hits).toEqual([]);
  });

  it("scores a word once however often it is asked, and treats a quoted period as words", () => {
    const sf = join(tmp("phrase-once"), "tray.json");
    drainPackets([
      note("deploy.md", t0, "# Deploy day\n\ncanary went out"),
      note("lw.md", t0 + 1000, "# What happened last week\n\nnotes"),
    ], sf, emptyCore(), kernel);
    const once = runAsk('"deploy canary"', sf, emptyCore(), kernel).hits[0];
    const twice = runAsk('deploy "deploy canary"', sf, emptyCore(), kernel).hits[0];
    expect(twice?.score).toBe(once?.score);
    expect(twice?.matched).toEqual(["deploy", "canary"]);
    // A period in quotes is a phrase someone wrote, not a filter: no --as-of needed.
    const quoted = runAsk('"last week"', sf, emptyCore(), kernel);
    expect(quoted.observationInterval).toBeUndefined();
    expect(quoted.hits.map((h) => h.note)).toEqual(["lw.md"]);
    expect(quoted.hits[0]?.phrases).toEqual({ "last week": "adjacent" });
  });

  it("means whole words by adjacent: a phrase inside another word is neither adjacent nor a hit", () => {
    const sf = join(tmp("phrase-words"), "tray.json");
    drainPackets([
      { id: "cc-prev", t: t0, channel: "claude-code", kind: "user-prompt", text: "Previews of the new dashboard" },
      { id: "cc-tw", t: t0, channel: "claude-code", kind: "user-prompt", text: "This week" },
    ], sf, emptyCore(), kernel);
    expect(runAsk('"review"', sf, emptyCore(), kernel).hits).toEqual([]);
    expect(runAsk('"is"', sf, emptyCore(), kernel).hits).toEqual([]);
    expect(runAsk('"this week"', sf, emptyCore(), kernel).hits[0]?.phrases).toEqual({ "this week": "adjacent" });
    // An empty quote pair never swallows the next phrase's opening quote.
    expect(extractPhrases('"" "planning"').phrases.map((p) => p.text)).toEqual(["planning"]);
  });

  it("finds a phrase typed exactly as a punctuated title as adjacent", () => {
    const sf = join(tmp("phrase-punct"), "tray.json");
    drainPackets([note("cd.md", t0, "# Canary/deploy plan\n\nsteps")], sf, emptyCore(), kernel);
    const hit = runAsk('"canary/deploy"', sf, emptyCore(), kernel).hits[0];
    expect(hit?.phrases).toEqual({ "canary deploy": "adjacent" });
  });

  it("combines with a period and stays deterministic", () => {
    const sf = join(tmp("phrase-period"), "tray.json");
    drainPackets([
      note("in.md", Date.parse("2026-09-02T12:00:00Z"), "# Canary rollout\n\nfine"),
      note("out.md", Date.parse("2026-08-20T12:00:00Z"), "# Canary rollout\n\nfine"),
    ], sf, emptyCore(), kernel);
    const a = runAsk('"canary rollout" last week', sf, emptyCore(), kernel, "2026-09-07");
    expect(a.hits.map((h) => h.note)).toEqual(["in.md"]);
    expect(JSON.stringify(runAsk('"canary rollout" last week', sf, emptyCore(), kernel, "2026-09-07")))
      .toBe(JSON.stringify(a));
  });
});

describe("quarantine gate", () => {
  // Secret-shaped bytes are assembled here, never committed to the repo.
  const AWS_EXAMPLE = "AKIA" + "IOSFODNN7EXAMPLE";
  const CRED_LINE = ["pass", "word"].join("") + " = hunter2-example";

  it("keeps flagged notes out of slots, episodes, writes, and the store", () => {
    const inbox = tmp("inbox");
    cpSync(join(FIXTURES, "standup.md"), join(inbox, "standup.md"));
    writeFileSync(
      join(inbox, "leaky.md"),
      `# Deploy note\n\nkey id ${AWS_EXAMPLE} appeared in the CI log.\n${CRED_LINE}\n`,
    );
    const storeFile = join(tmp("qstore"), "tray.json");
    const report = runTray(inbox, storeFile, emptyCore(), kernel);

    expect(report.notes).toEqual(["leaky.md", "standup.md"]);
    expect(report.quarantined.map((q) => q.note)).toContain("leaky.md");
    expect(report.committed).toEqual(["standup.md"]);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);

    // The anomaly flag routed on the declared control edge e4.
    expect(
      report.trace.events.some((e) => e.type === "edge.fire" && e.edge === "e4"),
    ).toBe(true);
    // Nothing about the leaky note reaches the store or the trace keys.
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic)).toEqual(["ep:standup.md"]);
    for (const e of report.trace.events) {
      if (e.type === "store.write") expect(e.keys.join()).not.toContain("leaky");
    }
  });

  it("does not fire e4 when the inbox is clean", () => {
    const report = runTray(FIXTURES, join(tmp("clean"), "tray.json"), emptyCore(), kernel);
    expect(
      report.trace.events.some((e) => e.type === "edge.fire" && e.edge === "e4"),
    ).toBe(false);
  });
});

describe("fixture hygiene", () => {
  it("notes carry no PAN-length digit runs, credentials, or KOHO URLs", () => {
    for (const f of readdirSync(FIXTURES)) {
      const text = readFileSync(join(FIXTURES, f), "utf8");
      expect(text).not.toMatch(/\d[\d\s-]{11,}\d/); // card/account number shapes
      expect(text.toLowerCase()).not.toMatch(/password|secret|api[_-]?key|bearer|token/);
      expect(text.toLowerCase()).not.toMatch(/koho\.(ca|com)|https?:\/\//);
    }
  });
});
