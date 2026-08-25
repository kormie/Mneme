import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { emptyCore } from "../src/core.js";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { emptyStore, loadStore, saveStore, type Episode, type Triple } from "../src/store.js";
import { drainPackets, runAsk } from "../src/tray.js";
import type { TraceEvent } from "../src/trace.js";

const kernel = loadKernel();
const SPECIAL_IDS = ["__proto__", "constructor", "hasOwnProperty"] as const;
type StoreWrite = Extract<TraceEvent, { type: "store.write" }>;

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `store-keys-${name}-`));
}

function packets(revision: string): Observation[] {
  return SPECIAL_IDS.map((id, i) => ({
    id,
    t: i,
    channel: "file",
    kind: "note",
    text: `# ${revision} ${id}\n\nMemory for ${id}.`,
  }));
}

describe("tray store packet-id keys", () => {
  it("persists, retrieves, and idempotently replaces Object.prototype names", () => {
    const storeFile = join(tmp("roundtrip"), "tray.json");
    drainPackets(packets("first"), storeFile, emptyCore(), kernel);

    const report = drainPackets(packets("replacement"), storeFile, emptyCore(), kernel);
    const secondBytes = readFileSync(storeFile, "utf8");
    const saved = JSON.parse(secondBytes) as {
      episodic: Record<string, unknown>;
      semantic: Record<string, unknown>;
    };
    const ltmWrites = report.trace.events.filter(
      (event): event is StoreWrite =>
        event.type === "store.write" && event.store !== "audit.inbox",
    );

    expect(report.committed).toEqual([...SPECIAL_IDS]);
    expect(ltmWrites).toHaveLength(SPECIAL_IDS.length * 2);
    expect(Object.keys(saved.episodic)).toHaveLength(SPECIAL_IDS.length);
    expect(Object.keys(saved.semantic)).toHaveLength(SPECIAL_IDS.length);
    for (const id of SPECIAL_IDS) {
      expect(
        ltmWrites.some((event) => event.store === "episodic" && event.keys.includes(`ep:${id}`)),
        `missing episode write ${id}`,
      ).toBe(true);
      expect(
        ltmWrites.some((event) => event.store === "semantic" && event.keys.includes(id)),
        `missing semantic write ${id}`,
      ).toBe(true);
      expect(Object.hasOwn(saved.episodic, `ep:${id}`), `missing saved episode ${id}`).toBe(true);
      expect(Object.hasOwn(saved.semantic, id), `missing saved semantics ${id}`).toBe(true);
    }

    // Every attested LTM write exists as an own key in the persisted JSON.
    for (const event of report.trace.events) {
      if (event.type !== "store.write" || event.store === "audit.inbox") continue;
      expect(["episodic", "semantic"]).toContain(event.store);
      const record = saved[event.store as "episodic" | "semantic"];
      for (const key of event.keys) {
        expect(Object.hasOwn(record, key), `trace/store disagreement for ${event.store}:${key}`).toBe(true);
      }
    }

    const store = loadStore(storeFile);
    expect(Object.getPrototypeOf(store.episodic)).toBeNull();
    expect(Object.getPrototypeOf(store.semantic)).toBeNull();
    for (const id of SPECIAL_IDS) {
      expect(store.episodic[`ep:${id}`]?.title).toBe(`replacement ${id}`);
      expect(store.semantic[id]).toContainEqual({
        s: id,
        p: "titled",
        o: `replacement ${id}`,
      });
      expect(runAsk(id, storeFile, emptyCore(), kernel).hits[0]?.note).toBe(id);
    }

    // Re-delivery replaces the same keys; it neither duplicates entries
    // nor changes the persisted bytes for the same packet versions.
    drainPackets(packets("replacement"), storeFile, emptyCore(), kernel);
    expect(readFileSync(storeFile, "utf8")).toBe(secondBytes);
  });

  it("keeps the ordinary-id JSON shape byte-stable", () => {
    const storeFile = join(tmp("ordinary"), "tray.json");
    const episodes: Episode[] = [
      {
        id: "ep:zulu.md",
        note: "zulu.md",
        title: "Zulu note",
        headings: [],
        channel: "file",
        kind: "note",
      },
      {
        id: "ep:alpha.md",
        note: "alpha.md",
        title: "Alpha note",
        headings: [],
        channel: "file",
        kind: "note",
      },
    ];
    const triples: Record<string, Triple[]> = {
      "zulu.md": [{ s: "zulu.md", p: "titled", o: "Zulu note" }],
      "alpha.md": [{ s: "alpha.md", p: "titled", o: "Alpha note" }],
    };
    const store = emptyStore();
    for (const episode of episodes) {
      store.episodic[episode.id] = episode;
      store.semantic[episode.note] = triples[episode.note]!;
    }
    saveStore(storeFile, store);

    const legacyShape = {
      store: "mneme.tray-store/v1",
      episodic: {
        "ep:alpha.md": episodes[1],
        "ep:zulu.md": episodes[0],
      },
      semantic: {
        "alpha.md": triples["alpha.md"],
        "zulu.md": triples["zulu.md"],
      },
    };
    expect(readFileSync(storeFile, "utf8")).toBe(JSON.stringify(legacyShape, null, 2) + "\n");
  });
});
