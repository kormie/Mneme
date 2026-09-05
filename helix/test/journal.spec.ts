/**
 * The journal: a period-bounded ask rendered as days (src/journal.ts,
 * `--journal`). Presentation over the same read path as --ask — same
 * hits, same trace — grouped by day in the interval's own offset and
 * listed in ascending observation time.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "bun:test";
import { emptyCore } from "../src/core.js";
import { journalLines, renderJournal } from "../src/journal.js";
import { loadKernel } from "../src/kernel.js";
import type { Observation } from "../src/observation.js";
import { drainPackets, runAsk } from "../src/tray.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELIX_ROOT = resolve(HERE, "..");
const TRAY = join(HELIX_ROOT, "src", "tray.ts");
const kernel = loadKernel();
const run = promisify(execFile);

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `journal-${name}-`));
}

function packet(id: string, iso: string, text: string, kind = "user-prompt"): Observation {
  return { id, t: Date.parse(iso), channel: "claude-code", kind, text };
}

/** A week of observations, 2026-08-31 (Monday) to 2026-09-05 (Saturday). */
function week(storeFile: string): void {
  drainPackets([
    packet("cc-mon-a", "2026-08-31T14:22:00Z", "Add a unit test for the anomaly gate's card-number rule."),
    packet("cc-wed-a", "2026-09-02T09:05:00Z", "Refactor the tray fixture loader to sort notes by name."),
    packet("cc-wed-b", "2026-09-02T17:40:00Z", "Why does the canary keep flapping?"),
    // 23:30Z on Thursday is 19:30 on Thursday at -04:00 — but 03:30 Friday at +04:00.
    packet("cc-thu-late", "2026-09-03T23:30:00Z", "Ship the canary fix before standup."),
    packet("cc-stop", "2026-09-03T23:31:00Z", "claude-code session stopped (cwd: /x)", "session-stop"),
    { id: "friday.md", t: Date.parse("2026-09-04T12:00:00Z"), channel: "file", kind: "note",
      text: "# Friday retro\n\n## Went well\n\n- canary held\n" },
  ], storeFile, emptyCore(), kernel);
}

describe("journal rendering", () => {
  it("groups by local day in the interval's offset and lists ascending, session-stop never present", () => {
    const storeFile = join(tmp("render"), "store.json");
    week(storeFile);
    const utc = runAsk("this week", storeFile, emptyCore(), kernel, "2026-09-05");
    const lines = journalLines(utc.hits, utc.observationInterval!);
    expect(lines.map((l) => `${l.day} ${l.time} ${l.note}`)).toEqual([
      "2026-08-31 14:22 cc-mon-a",
      "2026-09-02 09:05 cc-wed-a",
      "2026-09-02 17:40 cc-wed-b",
      "2026-09-03 23:30 cc-thu-late",
      "2026-09-04 12:00 friday.md",
    ]);
    expect(lines.map((l) => l.kind)).toEqual(["user-prompt", "user-prompt", "user-prompt", "user-prompt", "note"]);
    // Same instants, day boundaries four hours later: the late Thursday
    // prompt stays on Thursday, and the times read as local.
    const east = runAsk("this week", storeFile, emptyCore(), kernel, "2026-09-05", "-04:00");
    const local = journalLines(east.hits, east.observationInterval!);
    expect(local.map((l) => `${l.day} ${l.time} ${l.note}`)).toEqual([
      "2026-08-31 10:22 cc-mon-a",
      "2026-09-02 05:05 cc-wed-a",
      "2026-09-02 13:40 cc-wed-b",
      "2026-09-03 19:30 cc-thu-late",
      "2026-09-04 08:00 friday.md",
    ]);
    // …and four hours earlier, it becomes Friday morning.
    const west = runAsk("this week", storeFile, emptyCore(), kernel, "2026-09-05", "+04:00");
    expect(journalLines(west.hits, west.observationInterval!).find((l) => l.note === "cc-thu-late")?.day)
      .toBe("2026-09-04");
    // The hits themselves keep hybrid's declared order (newest first for a
    // pure-period ask); only the display copy is ascending.
    expect(utc.hits.map((h) => h.note)).toEqual(["friday.md", "cc-thu-late", "cc-wed-b", "cc-wed-a", "cc-mon-a"]);
  });

  it("renders headers with counts and weekday, clips titles, and honours a limit", () => {
    const storeFile = join(tmp("text"), "store.json");
    week(storeFile);
    const report = runAsk("this week", storeFile, emptyCore(), kernel, "2026-09-05");
    const out = renderJournal(report.hits, report.observationInterval!);
    expect(out[0]).toBe("2026-08-31 Monday — 1 observation(s), times at UTC+00:00");
    expect(out[1]).toBe('  14:22  claude-code/user-prompt  cc-mon-a  "Add a unit test for the anomaly gate\'s card-number rule."');
    expect(out[2]).toBe("2026-09-02 Wednesday — 2 observation(s), times at UTC+00:00");
    expect(out.filter((l) => !l.startsWith("  "))).toHaveLength(4); // four distinct days
    const capped = renderJournal(report.hits, report.observationInterval!, 2);
    expect(capped.filter((l) => l.startsWith("  ") && !l.includes("more observation"))).toHaveLength(2);
    expect(capped.at(-1)).toContain("… and 3 more observation(s) in this period");
    const empty = runAsk("last week", storeFile, emptyCore(), kernel, "2026-08-31"); // Aug 24–31: nothing
    expect(renderJournal(empty.hits, empty.observationInterval!)).toEqual(["  nothing remembered in this period"]);
  });

  it("keeps topic words as a filter and shows what matched", () => {
    const storeFile = join(tmp("topic"), "store.json");
    week(storeFile);
    const report = runAsk("canary this week", storeFile, emptyCore(), kernel, "2026-09-05");
    const lines = journalLines(report.hits, report.observationInterval!);
    expect(lines.map((l) => l.note)).toEqual(["cc-wed-b", "cc-thu-late", "friday.md"]);
    expect(lines.every((l) => l.matched.includes("canary"))).toBe(true);
    expect(renderJournal(report.hits, report.observationInterval!)[1]).toContain("[canary]");
  });
});

describe("--journal on the CLI", () => {
  it("prints the days, refuses a period-less question, and is byte-identical across runs", async () => {
    const dir = tmp("cli");
    const storeFile = join(dir, "store.json");
    week(storeFile);
    const args = ["--journal", "this week", "--as-of", "2026-09-05", "--utc-offset", "-04:00",
      "--store", storeFile, "--core", join(dir, "no-core.json"), "--out", join(dir, "j.json")];
    const first = await run("bun", [TRAY, ...args]);
    expect(first.stdout).toContain("journal: this week as of 2026-09-05: a calendar week, Monday to Monday; day boundaries at UTC-04:00");
    expect(first.stdout).toContain("2026-09-03 Thursday — 1 observation(s), times at UTC-04:00");
    expect(first.stdout).toContain('  19:30  claude-code/user-prompt  cc-thu-late  "Ship the canary fix before standup."');
    expect(first.stdout).toContain('  08:00  file/note  friday.md  "Friday retro"');
    expect(first.stdout).not.toContain("cc-stop");
    expect(first.stdout).toContain("read-only — no store.write");
    const second = await run("bun", [TRAY, ...args]);
    expect(second.stdout).toBe(first.stdout);
    // The journal's trace is the ask's trace: read-only, declared read path.
    const trace = JSON.parse(readFileSync(join(dir, "j.json"), "utf8")) as { events: { type: string }[] };
    expect(new Set(trace.events.map((e) => e.type))).toEqual(
      new Set(["node.enter", "node.exit", "edge.fire", "store.read"]),
    );
    await expect(run("bun", [TRAY, "--journal", "canary", "--store", storeFile, "--core", join(dir, "no-core.json")]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("the journal needs a period") });
    await expect(run("bun", [TRAY, "--journal", "x", "--ask", "y", "--core", join(dir, "no-core.json")]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("choose one mode") });
  });

  it("is reachable as bun run journal, and --ask hints at it for a bare period", async () => {
    const dir = tmp("script");
    const storeFile = join(dir, "store.json");
    week(storeFile);
    const j = await run("bun", ["run", "journal", "yesterday", "--as-of", "2026-09-05",
      "--store", storeFile, "--core", join(dir, "no-core.json"), "--out", join(dir, "j.json")], { cwd: HELIX_ROOT });
    expect(j.stdout).toContain("2026-09-04 Friday");
    expect(j.stdout).toContain("friday.md");
    const a = await run("bun", [TRAY, "--ask", "yesterday", "--as-of", "2026-09-05",
      "--store", storeFile, "--core", join(dir, "no-core.json"), "--out", join(dir, "a.json")]);
    expect(a.stdout).toContain("tip: --journal renders a period like this as a day-by-day journal");
  });
});
