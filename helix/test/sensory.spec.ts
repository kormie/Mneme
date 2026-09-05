/**
 * The pg-s2w sensor-normalize stand-in (src/sensory.ts): titles and
 * headings derived from packet text. A heading-less packet's title is
 * its first line, clipped at TITLE_MAX on a word boundary — the one
 * place near-prose enters the store, and it is bounded here.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { emptyCore } from "../src/core.js";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { TITLE_MAX, clipTitle, firstHeading, firstLine, headings } from "../src/sensory.js";
import { loadStore } from "../src/store.js";
import { drainPackets } from "../src/tray.js";

const kernel = loadKernel();

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `sensory-${name}-`));
}

describe("titles from packet text", () => {
  it("prefers the first heading, of any level, and keeps it whole", () => {
    const long = "# " + "word ".repeat(60).trim();
    expect(firstHeading(long)).toBe("word ".repeat(60).trim());
    expect(firstHeading("intro\n\n### Deep heading\ntext")).toBe("Deep heading");
    expect(firstHeading("no heading here")).toBeNull();
    expect(headings("# H1\n## H2\n### H3\nbody")).toEqual(["H2", "H3"]);
  });

  it("clips a heading-less first line at TITLE_MAX on a word boundary, nothing appended", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" "); // ~260 chars
    const title = firstLine(`\n\n${words}\nsecond line`) as string;
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(title.endsWith("…")).toBe(false);
    expect(title.endsWith(" ")).toBe(false);
    expect(words.startsWith(title + " ")).toBe(true); // cut between words
    expect(clipTitle("short")).toBe("short");
    expect(clipTitle("x".repeat(TITLE_MAX))).toBe("x".repeat(TITLE_MAX));
    // One unbroken run of TITLE_MAX+ characters has no boundary to cut at.
    expect(clipTitle("y".repeat(TITLE_MAX + 5))).toBe("y".repeat(TITLE_MAX));
    expect(firstLine("   \n  \n")).toBeNull();
  });

  it("stores the clipped title, and the `titled` triple equals it", () => {
    const text = "Please " + "refactor the loader and ".repeat(12) + "then stop.";
    expect(text.length).toBeGreaterThan(TITLE_MAX);
    const packet: Observation = {
      id: "cc-long-0001", t: 1756000000000, channel: "claude-code", kind: "user-prompt", text,
    };
    const storeFile = join(tmp("store"), "store.json");
    drainPackets([packet], storeFile, emptyCore(), kernel);
    const store = loadStore(storeFile);
    const title = store.episodic["ep:cc-long-0001"]?.title as string;
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(text.startsWith(title)).toBe(true);
    expect(store.semantic["cc-long-0001"]).toContainEqual({ s: "cc-long-0001", p: "titled", o: title });
    // Nothing in the store is longer than the clipped title except the
    // bounded keyword bag, so no stored string carries the whole prompt.
    for (const t of store.semantic["cc-long-0001"] ?? []) {
      expect(t.o.length).toBeLessThanOrEqual(TITLE_MAX);
    }
  });
});
