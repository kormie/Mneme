import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { loadKernel } from "../src/kernel.js";
import { permitPairing, runAsk, runTray } from "../src/tray.js";
import { loadStore } from "../src/store.js";
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
  const report = runTray(FIXTURES, storeFile, kernel);
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
    const again = runTray(FIXTURES, join(tmp("det"), "tray.json"), kernel);
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
  runTray(FIXTURES, storeFile, kernel);

  it("persists episodes and triples to the local store, idempotently", () => {
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic).sort()).toEqual(
      FIXTURE_NOTES.map((n) => `ep:${n}`).sort(),
    );
    runTray(FIXTURES, storeFile, kernel); // re-ingest: replace, not duplicate
    expect(loadStore(storeFile)).toEqual(store);
  });

  it("answers a question over the store via the declared read path", () => {
    const report = runAsk("what did I write about Jordan?", storeFile, kernel);
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
    const a = runAsk("blockers", storeFile, kernel);
    expect(a.hits[0]?.note).toBe("standup.md");
    expect(runAsk("blockers", storeFile, kernel).trace).toEqual(a.trace);
  });

  it("finds body prose via the capped keyword triples", () => {
    expect(runAsk("runbook", storeFile, kernel).hits[0]?.note).toBe("ci-failure.md");
    expect(runAsk("consume-once permits", storeFile, kernel).hits[0]?.note).toBe("standup.md");
  });

  it("folds accents so plain-ASCII queries find French notes", () => {
    const inbox = tmp("fr");
    writeFileSync(
      join(inbox, "reunion.md"),
      "# Réunion d'équipe\n\n## Décisions\n\n- prochaine étape lundi matin\n",
    );
    const sf = join(tmp("frstore"), "tray.json");
    runTray(inbox, sf, kernel);
    expect(runAsk("equipe", sf, kernel).hits[0]?.note).toBe("reunion.md");
    expect(runAsk("Décisions", sf, kernel).hits[0]?.note).toBe("reunion.md");
    expect(runAsk("etape", sf, kernel).hits[0]?.note).toBe("reunion.md");
  });

  it("answers gracefully over an empty store", () => {
    const report = runAsk("anything", join(tmp("empty"), "none.json"), kernel);
    expect(report.storeNotes).toBe(0);
    expect(report.hits).toEqual([]);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });

  it("refuses a corrupt store instead of silently wiping memory", () => {
    const file = join(tmp("corrupt"), "tray.json");
    writeFileSync(file, "{ not json");
    expect(() => runTray(FIXTURES, file, kernel)).toThrow();
    writeFileSync(file, JSON.stringify({ store: "something-else" }));
    expect(() => runTray(FIXTURES, file, kernel)).toThrow(/unrecognized/);
    expect(readFileSync(file, "utf8")).toContain("something-else"); // untouched
  });

  it("defers notes past the working-memory budget instead of dropping them silently", () => {
    const report = runTray(FIXTURES, join(tmp("budget"), "tray.json"), kernel, 2);
    expect(report.committed).toEqual(FIXTURE_NOTES.slice(0, 2));
    expect(report.deferred).toEqual(FIXTURE_NOTES.slice(2));
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
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
    const report = runTray(inbox, storeFile, kernel);

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
    const report = runTray(FIXTURES, join(tmp("clean"), "tray.json"), kernel);
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
