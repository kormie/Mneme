import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { emptyStore, loadStore, saveStore, type TrayStore } from "../src/store.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "mneme-store-"));
}

function legacy(): TrayStore {
  return {
    store: "mneme.tray-store/v1",
    episodic: {
      "ep:monday.md": {
        id: "ep:monday.md", note: "monday.md", title: "Monday", headings: ["Follow up"],
      },
    },
    semantic: { "monday.md": [{ s: "monday.md", p: "titled", o: "Monday" }] },
  };
}

describe("tray store compatibility and validation", () => {
  it("starts empty only when the file is absent", () => {
    const file = join(temp(), "absent.json");
    expect(loadStore(file)).toEqual(emptyStore());
    expect(existsSync(file)).toBe(false);
    expect(() => loadStore(temp())).toThrow();
  });

  it("reads the old format without inventing excerpts, channels, or dates", () => {
    const file = join(temp(), "old.json");
    writeFileSync(file, JSON.stringify(legacy()));
    const loaded = loadStore(file);
    expect(loaded).toEqual(legacy());
    expect(Object.hasOwn(loaded.episodic["ep:monday.md"]!, "excerpt")).toBe(false);
    expect(Object.hasOwn(loaded.episodic["ep:monday.md"]!, "observedAt")).toBe(false);
    saveStore(file, loaded);
    expect(loadStore(file)).toEqual(loaded);
  });

  it("preserves a bounded source excerpt and its observation time", () => {
    const file = join(temp(), "memory.json");
    const memory = legacy();
    Object.assign(memory.episodic["ep:monday.md"]!, {
      channel: "file", excerpt: "é".repeat(1200), observedAt: 1_783_800_000_000,
    });
    saveStore(file, memory);
    expect(loadStore(file)).toEqual(memory);
  });

  for (const [label, mutate] of [
    ["null document", () => null],
    ["array document", () => []],
    ["array episode dictionary", (s: TrayStore) => ({ ...s, episodic: [] })],
    ["array semantic dictionary", (s: TrayStore) => ({ ...s, semantic: [] })],
    ["null episode", (s: TrayStore) => ({ ...s, episodic: { "ep:monday.md": null } })],
    ["missing title", (s: TrayStore) => ({ ...s, episodic: { "ep:monday.md": { id: "ep:monday.md", note: "monday.md", headings: [] } } })],
    ["mismatched episode id", (s: TrayStore) => ({ ...s, episodic: { "ep:monday.md": { ...s.episodic["ep:monday.md"], id: "ep:other.md" } } })],
    ["invalid heading", (s: TrayStore) => ({ ...s, episodic: { "ep:monday.md": { ...s.episodic["ep:monday.md"], headings: [null] } } })],
    ["oversized excerpt", (s: TrayStore) => ({ ...s, episodic: { "ep:monday.md": { ...s.episodic["ep:monday.md"], excerpt: "x".repeat(1201) } } })],
    ["null timestamp", (s: TrayStore) => ({ ...s, episodic: { "ep:monday.md": { ...s.episodic["ep:monday.md"], observedAt: null } } })],
    ["unrenderable timestamp", (s: TrayStore) => ({ ...s, episodic: { "ep:monday.md": { ...s.episodic["ep:monday.md"], observedAt: 9e15 } } })],
    ["null triples", (s: TrayStore) => ({ ...s, semantic: { "monday.md": null } })],
    ["invalid triple", (s: TrayStore) => ({ ...s, semantic: { "monday.md": [{ s: "monday.md", p: "mentions", o: 12 }] } })],
    ["mismatched triple subject", (s: TrayStore) => ({ ...s, semantic: { "monday.md": [{ s: "another.md", p: "mentions", o: "meeting" }] } })],
  ] as const) {
    it(`refuses ${label} without changing the file`, () => {
      const file = join(temp(), "bad.json");
      const text = JSON.stringify(mutate(legacy()));
      writeFileSync(file, text);
      expect(() => loadStore(file)).toThrow(/unrecognized tray store format/);
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  }

  it("treats prototype-shaped observation ids as ordinary dictionary keys", () => {
    const file = join(temp(), "keys.json");
    const memory = emptyStore();
    for (const note of ["__proto__", "constructor", "prototype"]) {
      memory.episodic[`ep:${note}`] = { id: `ep:${note}`, note, title: note, headings: [] };
      memory.semantic[note] = [{ s: note, p: "titled", o: note }];
    }
    saveStore(file, memory);
    const loaded = loadStore(file);
    expect(Object.keys(loaded.semantic)).toEqual(["__proto__", "constructor", "prototype"]);
    expect(Object.getPrototypeOf(loaded.semantic)).toBeNull();
    expect(Object.getPrototypeOf(loaded.episodic)).toBeNull();
    loaded.semantic["__proto__"] = [{ s: "__proto__", p: "titled", o: "Updated" }];
    saveStore(file, loaded);
    expect(loadStore(file).semantic["__proto__"]?.[0]?.o).toBe("Updated");
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe("atomic personal memory persistence", () => {
  it("writes private files and replaces complete snapshots with sorted keys", () => {
    const directory = temp();
    const file = join(directory, "profile", "memory.json");
    saveStore(file, legacy());
    const previousInode = statSync(file).ino;
    const memory = loadStore(file);
    memory.episodic["ep:alpha.md"] = { id: "ep:alpha.md", note: "alpha.md", title: "Alpha", headings: [] };
    memory.semantic["alpha.md"] = [{ s: "alpha.md", p: "titled", o: "Alpha" }];
    saveStore(file, memory);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(file).ino).not.toBe(previousInode);
    expect(Object.keys(loadStore(file).episodic)).toEqual(["ep:alpha.md", "ep:monday.md"]);
    expect(readdirSync(join(directory, "profile"))).toEqual(["memory.json"]);
  });

  it("leaves committed memory unchanged when the proposed snapshot is invalid", () => {
    const directory = temp();
    const file = join(directory, "memory.json");
    saveStore(file, legacy());
    const previous = readFileSync(file, "utf8");
    const memory = loadStore(file);
    memory.episodic["ep:monday.md"]!.observedAt = Number.NaN;
    expect(() => saveStore(file, memory)).toThrow(/invalid episode/);
    expect(readFileSync(file, "utf8")).toBe(previous);
    memory.episodic["ep:monday.md"]!.observedAt = 1;
    memory.semantic["monday.md"] = new Array(1);
    expect(() => saveStore(file, memory)).toThrow(/invalid triples/);
    expect(readFileSync(file, "utf8")).toBe(previous);
    expect(readdirSync(directory)).toEqual(["memory.json"]);
  });

  it("cleans its temporary file when replacement fails, preserving the destination", () => {
    const directory = temp();
    const destination = join(directory, "memory.json");
    mkdirSync(destination);
    writeFileSync(join(destination, "keep.txt"), "prior destination");
    expect(() => saveStore(destination, legacy())).toThrow();
    expect(readFileSync(join(destination, "keep.txt"), "utf8")).toBe("prior destination");
    expect(readdirSync(directory)).toEqual(["memory.json"]);
  });
});
