import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadStore } from "../src/store.js";
import { loadKernel } from "../src/kernel.js";
import { judge } from "../src/judge.js";
import { countType, type TraceFile } from "../src/trace.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), "mneme-daily-tests-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
function profile(name: string): string { return join(workspace, name); }
function cli(home: string, args: string[], input?: string) {
  return spawnSync(process.execPath, [join(root, "helix/src/daily.ts"), "--home", home, ...args], {
    cwd: workspace, encoding: "utf8", ...(input === undefined ? {} : { input }),
    env: { ...process.env, TZ: "America/New_York" },
  });
}
function json(home: string, args: string[], input?: string) {
  const result = cli(home, [...args, "--json"], input);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe("daily memory workflow", () => {
  it("captures without committing, then remembers and recalls source context", () => {
    const home = profile("workflow");
    const captured = json(home, ["capture", "--title", "Garden decision"], "Use raised beds because the soil stays wet.\n");
    expect(captured.remembered).toBe(false);
    expect(statSync(captured.captured).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(home, "inbox"))).toHaveLength(1);
    expect(Object.keys(loadStore(join(home, "store.json")).episodic)).toHaveLength(0);
    const remembered = json(home, ["remember"]);
    expect(remembered.remembered).toBe(1);
    expect(remembered.total).toBe(1);
    const before = readFileSync(join(home, "store.json"), "utf8");
    const recalled = json(home, ["recall", "raised beds"]);
    expect(recalled.hits[0].excerpt).toContain("because the soil stays wet");
    expect(countType(recalled.trace.events, "store.write")).toBe(0);
    expect(countType(recalled.trace.events, "core.permit")).toBe(0);
    expect(readFileSync(join(home, "store.json"), "utf8")).toBe(before);
    expect(json(home, ["recent"]).hits).toHaveLength(1);
    expect(json(home, ["recall", "garden today"]).hits).toHaveLength(1);
    expect(json(home, ["remember"]).total).toBe(1);
    expect(readFileSync(join(home, "store.json"), "utf8")).toBe(before);
  });

  it("processes both sources beyond the 64-slot budget with lawful writes", () => {
    const home = profile("batches");
    mkdirSync(join(home, "inbox"), { recursive: true });
    for (let i = 0; i < 66; i++) writeFileSync(join(home, "inbox", `${i}.md`), `# Note ${i}\nGarden planning detail ${i}`);
    writeFileSync(join(home, "buffer.jsonl"), JSON.stringify({ id: "cc-event", t: Date.now(), channel: "claude-code", kind: "user-prompt", text: "# Session plan\nWrite the garden checklist." }) + "\n");
    const result = json(home, ["remember"]);
    expect(result.remembered).toBe(67);
    expect(result.batches).toBe(2);
    expect(result.total).toBe(67);
    const trace = JSON.parse(readFileSync(result.trace, "utf8")) as TraceFile;
    expect(judge(loadKernel(), trace.events).judged).toBe(true);
    expect(countType(trace.events, "core.permit")).toBe(134);
    for (const event of ["twin.install", "steward.ack", "cap.mint", "cap.revoke", "twin.action", "cluster.cut", "archive.sample"] as const) {
      expect(countType(trace.events, event)).toBe(0);
    }
    expect(json(home, ["remember"]).total).toBe(67);
  });

  it("quarantines the full source even when unsafe content falls past the excerpt cap", () => {
    const home = profile("quarantine");
    const secret = ["pass", "word"].join("") + " = demo-credential-value";
    json(home, ["capture", "# Deployment note\n" + "ordinary text ".repeat(130) + secret]);
    const result = json(home, ["remember"]);
    expect(result.remembered).toBe(0);
    expect(result.quarantined.length).toBeGreaterThan(0);
    expect(readFileSync(join(home, "store.json"), "utf8")).not.toContain(secret);
    expect(readFileSync(result.trace, "utf8")).not.toContain(secret);
  });

  it("does not create a memory file for empty sources", () => {
    const home = profile("empty");
    expect(json(home, ["remember"]).trace).toBeNull();
    expect(() => statSync(join(home, "store.json"))).toThrow();
    expect(json(home, ["status"]).notes).toBe(0);
  });

  it("preserves memory if trace output fails after staging multiple batches", () => {
    const home = profile("rollback");
    json(home, ["capture", "A previous useful memory"]);
    json(home, ["remember"]);
    const before = readFileSync(join(home, "store.json"), "utf8");
    const packets = Array.from({ length: 65 }, (_, i) => ({ id: `packet-${i}`, t: Date.now(), channel: "claude-code", kind: "note", text: `# Added note ${i}` }));
    writeFileSync(join(home, "buffer.jsonl"), packets.map((p) => JSON.stringify(p)).join("\n"));
    rmSync(join(home, "traces"), { recursive: true });
    writeFileSync(join(home, "traces"), "not a directory");
    expect(cli(home, ["remember"]).status).toBe(1);
    expect(readFileSync(join(home, "store.json"), "utf8")).toBe(before);
    expect(readdirSync(home).filter((f) => f.startsWith(".remember"))).toEqual([]);
  });

  it("reads spooled packets without a daemon and preserves Core provenance decisions", () => {
    const home = profile("spool-core");
    mkdirSync(join(home, "spool"), { recursive: true });
    const core = JSON.stringify({ values: ["human-utterance-only"], goals: [], prose: "Only my observations." });
    writeFileSync(join(home, "core.json"), core);
    for (const kind of ["agent-note", "user-prompt", "session-stop"]) {
      writeFileSync(join(home, "spool", `${kind}.json`), JSON.stringify({ id: kind, t: Date.now(), channel: "claude-code", kind, text: `# Source ${kind}\nGarden context.` }));
    }
    const result = json(home, ["remember"]);
    expect(result.remembered).toBe(1);
    expect(result.denied).toEqual(["agent-note"]);
    expect(result.observedOnly).toBe(1);
    expect(readdirSync(join(home, "spool"))).toHaveLength(3);
    expect(readFileSync(join(home, "core.json"), "utf8")).toBe(core);
    expect(json(home, ["recall", "garden"]).hits.map((h: { note: string }) => h.note)).toEqual(["user-prompt"]);
    const trace = JSON.parse(readFileSync(result.trace, "utf8")) as TraceFile;
    expect(countType(trace.events, "core.deny")).toBeGreaterThan(0);
    expect(judge(loadKernel(), trace.events).judged).toBe(true);
  });

  it("deduplicates identical buffer/spool deliveries and refuses conflicting copies", () => {
    const home = profile("spool-dedup");
    mkdirSync(join(home, "spool"), { recursive: true });
    const packet = { id: "same-observation", t: Date.now(), channel: "claude-code", kind: "user-prompt", text: "Garden idea" };
    writeFileSync(join(home, "buffer.jsonl"), JSON.stringify(packet));
    writeFileSync(join(home, "spool", "packet.json"), JSON.stringify(packet));
    expect(json(home, ["remember"]).remembered).toBe(1);
    const before = readFileSync(join(home, "store.json"), "utf8");
    writeFileSync(join(home, "spool", "packet.json"), JSON.stringify({ ...packet, text: "Conflicting contents" }));
    expect(cli(home, ["remember"]).stderr).toContain("conflicting adapter packets");
    expect(readFileSync(join(home, "store.json"), "utf8")).toBe(before);
  });

  it("refuses unsupported or malformed Core before writing candidate or memory files", () => {
    const home = profile("unsupported-core");
    mkdirSync(home);
    writeFileSync(join(home, "core.json"), JSON.stringify({ values: ["unimplemented-steward-value"], goals: [], prose: "" }));
    for (const args of [["capture", "test note"], ["remember"], ["recall", "test"], ["recent"], ["status"], ["doctor"]]) {
      const result = cli(home, args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("cannot interpret core value");
    }
    expect(readdirSync(home)).toEqual(["core.json"]);
    writeFileSync(join(home, "core.json"), "{broken");
    expect(cli(home, ["remember"]).status).toBe(1);
    expect(readdirSync(home)).toEqual(["core.json"]);
  });

  it("fails on source id collisions instead of replacing unrelated memory", () => {
    const home = profile("collisions");
    mkdirSync(join(home, "inbox"), { recursive: true });
    writeFileSync(join(home, "inbox/same.md"), "# Handwritten note");
    writeFileSync(join(home, "buffer.jsonl"), JSON.stringify({ id: "same.md", t: 0, channel: "claude-code", kind: "note", text: "Different source" }));
    const result = cli(home, ["remember"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("source id collision");
    expect(Object.keys(loadStore(join(home, "store.json")).episodic)).toHaveLength(0);
  });

  it("refuses a concurrent writer or malformed existing store", () => {
    const home = profile("lock");
    json(home, ["capture", "Fresh note"]);
    mkdirSync(join(home, ".remember-lock"));
    expect(cli(home, ["remember"]).stderr).toContain("another remember");
    rmSync(join(home, ".remember-lock"), { recursive: true });
    writeFileSync(join(home, "store.json"), "broken-json");
    expect(cli(home, ["remember"]).status).toBe(1);
    expect(readFileSync(join(home, "store.json"), "utf8")).toBe("broken-json");
  });

  it("uses inclusive local calendar dates and validates command options", () => {
    const home = profile("dates");
    mkdirSync(home);
    const packets = ["2026-09-04T00:00:00-04:00", "2026-09-04T23:59:59-04:00", "2026-09-05T00:00:00-04:00"].map((t, i) => ({ id: `dated-${i}`, t: Date.parse(t), channel: "file", kind: "note", text: "Garden details" }));
    writeFileSync(join(home, "buffer.jsonl"), packets.map((p) => JSON.stringify(p)).join("\n"));
    json(home, ["remember"]);
    expect(json(home, ["recall", "garden", "--since", "2026-09-04", "--until", "2026-09-04"]).hits).toHaveLength(2);
    for (const args of [
      ["recall"], ["recent", "--days", "0"], ["recall", "garden", "--since", "2026-02-30"],
      ["recall", "garden", "--since", "2026-09-05", "--until", "2026-09-04"],
      ["status", "--inbox", home], ["remember", "--buffer", join(home, "missing.jsonl")],
    ]) expect(cli(home, args).status).toBe(1);
  });

  it("launcher works from another directory and demo leaves a selected profile untouched", () => {
    const launcher = spawnSync(join(root, "mneme"), ["help"], { cwd: workspace, encoding: "utf8" });
    expect(launcher.status).toBe(0);
    expect(launcher.stdout).toContain("remember");
    const home = profile("demo-personal");
    json(home, ["capture", "A personal note"]);
    json(home, ["remember"]);
    const before = readFileSync(join(home, "store.json"), "utf8");
    const result = cli(home, ["demo"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("borrow the trolley");
    expect(readFileSync(join(home, "store.json"), "utf8")).toBe(before);
    const demoHome = result.stdout.match(/Try your own query: \.\/mneme --home (.+) recall/)?.[1];
    if (demoHome?.includes("mneme-demo-")) rmSync(demoHome, { recursive: true, force: true });
  });
});
