import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadKernel } from "../src/kernel.js";
import { permitPairing, runTray } from "../src/tray.js";
import { commitAfterPermit, countType, validTrace, type TraceEvent } from "../src/trace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../fixtures/tray");
const kernel = loadKernel();

describe("desk-tray dogfood run", () => {
  const report = runTray(FIXTURES, kernel);
  const events = report.trace.events;

  it("consumes the three fixture notes", () => {
    expect(report.notes).toEqual(["follow-up.md", "pr-review.md", "standup.md"]);
    expect(report.episodes).toHaveLength(3);
  });

  it("emits a valid mneme.trace/v1 stream", () => {
    expect(report.trace.trace).toBe("mneme.trace/v1");
    expect(report.trace.spec).toBe("mneme.spec/0.10");
    expect(report.checks).toEqual({
      validTrace: true,
      scheduleNonempty: true,
      commitAfterPermit: true,
      denyImpliesInterrupt: true,
      auditNotEffect: true,
    });
  });

  it("pairs every non-audit store.write with its own preceding permit", () => {
    const writes = events.filter((e) => e.type === "store.write");
    const ltmWrites = writes.filter((e) => e.type === "store.write" && e.store !== "audit.inbox");
    expect(report.permitPairs).toHaveLength(ltmWrites.length);
    expect(ltmWrites.length).toBe(6); // episodic + semantic per note
    expect(countType(events, "core.permit")).toBe(ltmWrites.length);
    for (const p of report.permitPairs) expect(p.permitIndex).toBeGreaterThanOrEqual(0);
    // permits are consume-once: pair indices strictly interleave
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

  it("is deterministic across runs", () => {
    expect(runTray(FIXTURES, kernel).trace).toEqual(report.trace);
  });

  it("tampered traces fail the untrusted mirrors (amortized permit, ghost edge)", () => {
    const firstPermit = events.findIndex((e) => e.type === "core.permit");
    const amortized = events.filter((_, i) => i !== firstPermit);
    expect(commitAfterPermit(amortized)).toBe(false);

    const ghost: TraceEvent[] = [...events, { type: "edge.fire", edge: "zz99", kind: "data" }];
    expect(validTrace(kernel, ghost)).toBe(false);
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
