import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadKernel } from "../src/kernel.js";
import { isObservation, type Observation } from "../src/observation.js";
import { loadStore } from "../src/store.js";
import { drainPackets, readBuffer, runAsk } from "../src/tray.js";
import { countType } from "../src/trace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../fixtures/adapters");
const kernel = loadKernel();

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `buffer-${name}-`));
}

function fixturePacket(): Observation {
  const packet = JSON.parse(
    readFileSync(join(FIXTURES, "claude-code-user-prompt.json"), "utf8"),
  ) as Observation;
  expect(isObservation(packet)).toBe(true);
  return packet;
}

describe("the L0 sensory buffer drains into tray LTM", () => {
  it("drains a fixture claude-code packet under consume-once permits, idempotently", () => {
    // A temp buffer holding exactly what the listener would have appended.
    const packet = fixturePacket();
    const bufferFile = join(tmp("drain"), "buffer.ndjson");
    writeFileSync(bufferFile, JSON.stringify(packet) + "\n");
    const storeFile = join(tmp("drain-store"), "tray.json");

    const { packets, skipped } = readBuffer(bufferFile);
    expect(skipped).toBe(0);
    const report = drainPackets(packets, storeFile, kernel);
    const events = report.trace.events;
    expect(report.committed).toEqual([packet.id]);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);

    // The packet id is the memory key, and the channel survived into the
    // store — both as an episode field and as a queryable triple.
    const store = loadStore(storeFile);
    const ep = store.episodic[`ep:${packet.id}`];
    console.log(`store episodic["ep:${packet.id}"].channel = ${ep?.channel}`);
    expect(ep?.channel).toBe("claude-code");
    expect(store.semantic[packet.id]).toContainEqual({
      s: packet.id,
      p: "channel",
      o: "claude-code",
    });

    // Every non-audit store.write consumed its own preceding core.permit.
    const nonAudit = events.filter(
      (e) => e.type === "store.write" && e.store !== "audit.inbox",
    );
    for (const p of report.permitPairs) {
      console.log(`store.write[${p.writeIndex}] ${p.store} ← core.permit[${p.permitIndex}]`);
      expect(p.permitIndex).toBeGreaterThanOrEqual(0);
      expect(p.permitIndex).toBeLessThan(p.writeIndex);
    }
    expect(report.permitPairs).toHaveLength(nonAudit.length);
    expect(countType(events, "core.permit")).toBe(nonAudit.length);
    const permitIndices = report.permitPairs.map((p) => p.permitIndex);
    expect(new Set(permitIndices).size).toBe(permitIndices.length); // never amortized
    // audit.inbox stays permit-exempt: it is a write, but never paired.
    expect(
      events.filter((e) => e.type === "store.write" && e.store === "audit.inbox"),
    ).toHaveLength(1);

    // The negative surface stays quiet.
    for (const t of ["twin.install", "steward.ack", "cap.mint"] as const) {
      console.log(`${t} events: ${countType(events, t)}`);
      expect(countType(events, t), t).toBe(0);
    }

    // Re-run the drain: the same id replaces its entry, so the store's
    // entry count (and content) is unchanged.
    const entries = (s: ReturnType<typeof loadStore>): number =>
      Object.keys(s.episodic).length + Object.keys(s.semantic).length;
    const before = entries(store);
    drainPackets(readBuffer(bufferFile).packets, storeFile, kernel);
    const after = loadStore(storeFile);
    console.log(`store entries before re-drain: ${before}, after: ${entries(after)}`);
    expect(entries(after)).toBe(before);
    expect(after).toEqual(store);
  });

  it("treats a re-delivered id as a replacement, not a second packet", () => {
    const packet = fixturePacket();
    const bufferFile = join(tmp("redeliver"), "buffer.ndjson");
    writeFileSync(bufferFile, JSON.stringify(packet) + "\n");
    // At-least-once delivery: the same id arrives again, edited.
    appendFileSync(
      bufferFile,
      JSON.stringify({ ...packet, t: packet.t + 1, text: "Edited: keep only this version." }) + "\n",
    );
    const { packets } = readBuffer(bufferFile);
    expect(packets).toHaveLength(1);
    const storeFile = join(tmp("redeliver-store"), "tray.json");
    drainPackets(packets, storeFile, kernel);
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic)).toEqual([`ep:${packet.id}`]);
    expect(store.episodic[`ep:${packet.id}`]?.title).toBe(
      "Edited: keep only this version.",
    );
  });

  it("keeps quarantined ids out of the store.write keys and the store", () => {
    const clean = fixturePacket();
    const leaky: Observation = {
      id: "cc-leaky-0001",
      t: clean.t + 1,
      channel: "claude-code",
      kind: "user-prompt",
      text: "set AWS_SECRET_ACCESS_KEY=abc123 in the deploy env",
    };
    const bufferFile = join(tmp("leaky"), "buffer.ndjson");
    writeFileSync(
      bufferFile,
      JSON.stringify(clean) + "\n" + JSON.stringify(leaky) + "\n",
    );
    const storeFile = join(tmp("leaky-store"), "tray.json");
    const report = drainPackets(readBuffer(bufferFile).packets, storeFile, kernel);

    expect(report.quarantined.map((q) => q.note)).toContain(leaky.id);
    expect(report.committed).toEqual([clean.id]);
    for (const e of report.trace.events) {
      if (e.type === "store.write") {
        expect(e.keys.join(), "quarantined id leaked into a write key").not.toContain(leaky.id);
      }
    }
    const store = loadStore(storeFile);
    expect(Object.keys(store.episodic)).toEqual([`ep:${clean.id}`]);
    expect(Object.keys(store.semantic)).toEqual([clean.id]);
  });

  it("answers a phrase from the drained packet via --ask, without writing", () => {
    const packet = fixturePacket();
    const storeFile = join(tmp("ask-store"), "tray.json");
    drainPackets([packet], storeFile, kernel);

    // The fixture packet says "Refactor the tray fixture loader…"; a
    // lexical query over the store finds it — no model, no network.
    const report = runAsk("fixture loader", storeFile, kernel);
    console.log(
      `ask hit: ${report.hits[0]?.note} (matched ${report.hits[0]?.matched.join(", ")})`,
    );
    expect(report.hits[0]?.note).toBe(packet.id);
    expect(report.hits[0]?.matched).toEqual(
      expect.arrayContaining(["fixture", "loader"]),
    );
    // Ask mode is read-only: no store.write, no permit, in its trace.
    console.log(`ask-mode store.write events: ${countType(report.trace.events, "store.write")}`);
    expect(countType(report.trace.events, "store.write")).toBe(0);
    expect(countType(report.trace.events, "core.permit")).toBe(0);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });

  it("skips non-packet lines instead of failing the whole drain", () => {
    const bufferFile = join(tmp("junk"), "buffer.ndjson");
    writeFileSync(
      bufferFile,
      JSON.stringify(fixturePacket()) + "\nnot a packet\n{\"id\":\"\"}\n",
    );
    const { packets, skipped } = readBuffer(bufferFile);
    expect(packets).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("refuses a buffer with no packets at all", () => {
    const bufferFile = join(tmp("empty"), "buffer.ndjson");
    writeFileSync(bufferFile, "\n\n");
    expect(() => readBuffer(bufferFile)).toThrow(/no Observation packets/);
  });
});
