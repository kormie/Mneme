import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { loadKernel } from "../src/kernel.js";
import { drainSpool, listenChecks, processBatch, senseBatch } from "../src/listen.js";
import { isObservation, parseObservation, type Observation } from "../src/observation.js";
import { makeEmitter } from "../src/scheduler.js";
import { countType } from "../src/trace.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../fixtures/adapters");
const HOOK = resolve(HERE, "../adapters/claude-code/hook.mjs");
const kernel = loadKernel();
const run = promisify(execFile);

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `adapter-${name}-`));
}

function fixturePacket(): Observation {
  const packet = JSON.parse(
    readFileSync(join(FIXTURES, "claude-code-user-prompt.json"), "utf8"),
  ) as Observation;
  expect(isObservation(packet)).toBe(true);
  return packet;
}

describe("a synthetic claude-code packet through the sensory loop", () => {
  const packet = fixturePacket();
  const emitter = makeEmitter();
  const bufferFile = join(tmp("buffer"), "buffer.ndjson");
  const batch = processBatch(kernel, [packet], emitter, bufferFile);
  const events = emitter.events;

  it("rides pg-s2w's declared ingress into a working-memory slot", () => {
    console.log(`packet channel: ${packet.channel}`);
    expect(packet.channel).toBe("claude-code");
    const enters = events.filter((e) => e.type === "node.enter" && e.graph === "pg-s2w");
    console.log(`node.enter pg-s2w events: ${enters.length}`);
    expect(enters.length).toBeGreaterThan(0);
    expect(batch.slots).toBe(1);
    expect(batch.accepted).toEqual([packet.id]);
    expect(batch.quarantined).toEqual([]);
  });

  it("never installs, acks, mints, or writes a store", () => {
    for (const t of ["twin.install", "steward.ack", "cap.mint", "twin.action", "store.write"] as const) {
      console.log(`${t} events: ${countType(events, t)}`);
      expect(countType(events, t), t).toBe(0);
    }
    const checks = listenChecks(kernel, emitter);
    expect(Object.values(checks).every(Boolean), JSON.stringify(checks)).toBe(true);
  });

  it("buffers the clean packet verbatim, one JSON line", () => {
    const lines = readFileSync(bufferFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(parseObservation(lines[0] as string)).toEqual(packet);
  });

  it("keeps the hook source free of memory writes and transcript scraping", () => {
    const src = readFileSync(HOOK, "utf8");
    console.log(`hook source contains "store.write": ${src.includes("store.write")}`);
    expect(src).not.toContain("store.write");
    expect(src).not.toContain(".claude/projects");
    expect(src).not.toContain("jsonl");
    expect(src).not.toContain("transcript_path");
  });
});

describe("the quarantine holds on the claude-code channel", () => {
  it("drops a packet with a credential assignment, buffering nothing", () => {
    const emitter = makeEmitter();
    const bufferFile = join(tmp("quarantine"), "buffer.ndjson");
    const bad: Observation = {
      id: "cc-fixture-bad",
      t: 1756000000001,
      channel: "claude-code",
      kind: "user-prompt",
      text: "set AWS_SECRET_ACCESS_KEY=abc123 in the deploy env",
    };
    const batch = processBatch(kernel, [bad], emitter, bufferFile);
    expect(batch.accepted).toEqual([]);
    expect(batch.slots).toBe(0);
    expect(batch.quarantined.map((m) => m.note)).toContain(bad.id);
    expect(existsSync(bufferFile)).toBe(false);
  });
});

describe("the spool directory", () => {
  it("drains valid packets, deletes them, and sidelines garbage as .bad", () => {
    const spool = tmp("spool");
    const a = { ...fixturePacket(), id: "cc-spool-a" };
    const b = { ...fixturePacket(), id: "cc-spool-b" };
    writeFileSync(join(spool, "a.json"), JSON.stringify(a));
    writeFileSync(join(spool, "b.json"), JSON.stringify(b));
    writeFileSync(join(spool, "junk.json"), "not a packet");
    const packets = drainSpool(spool);
    expect(packets.map((p) => p.id)).toEqual(["cc-spool-a", "cc-spool-b"]);
    expect(readdirSync(spool).sort()).toEqual(["junk.json.bad"]);
    expect(drainSpool(spool)).toEqual([]);
  });

  it("returns nothing for a spool directory that never existed", () => {
    expect(drainSpool(join(tmp("empty"), "nope"))).toEqual([]);
  });
});

describe("the claude-code hook process", () => {
  it("delivers a UserPromptSubmit packet over the unix socket and exits 0", async () => {
    const dir = tmp("sock");
    const sockPath = join(dir, "s.sock");
    const received = new Promise<string>((resolveLine) => {
      const server: Server = createServer((sock) => {
        let buf = "";
        sock.on("data", (c) => {
          buf += c.toString("utf8");
        });
        sock.on("end", () => {
          server.close();
          resolveLine(buf);
        });
      });
      server.listen(sockPath);
    });
    const stdin = readFileSync(join(FIXTURES, "hook-user-prompt-submit.json"), "utf8");
    const child = run("node", [HOOK], {
      env: { ...process.env, MNEME_SOCK: sockPath, MNEME_SPOOL: join(dir, "spool") },
    });
    child.child.stdin?.end(stdin);
    const { stdout } = await child; // execFile rejects on a non-zero exit
    expect(stdout).toBe(""); // hook stdout would be injected into context
    const packet = parseObservation(await received);
    expect(packet).not.toBeNull();
    expect(packet?.channel).toBe("claude-code");
    expect(packet?.kind).toBe("user-prompt");
    expect(packet?.text).toBe(
      "Add a unit test for the anomaly gate's card-number rule.",
    );
    expect(existsSync(join(dir, "spool"))).toBe(false);
  });

  it("spools the packet and still exits 0 when the socket is down", async () => {
    const dir = tmp("down");
    const spool = join(dir, "spool");
    const stdin = readFileSync(join(FIXTURES, "hook-user-prompt-submit.json"), "utf8");
    const child = run("node", [HOOK], {
      env: { ...process.env, MNEME_SOCK: join(dir, "no.sock"), MNEME_SPOOL: spool },
    });
    child.child.stdin?.end(stdin);
    await child;
    const spooled = drainSpool(spool);
    expect(spooled).toHaveLength(1);
    expect(spooled[0]?.channel).toBe("claude-code");
    expect(spooled[0]?.kind).toBe("user-prompt");
  });

  it("turns a Stop payload into a session-stop packet without reading anything else", async () => {
    const dir = tmp("stop");
    const spool = join(dir, "spool");
    const stdin = readFileSync(join(FIXTURES, "hook-stop.json"), "utf8");
    const child = run("node", [HOOK], {
      env: { ...process.env, MNEME_SOCK: join(dir, "no.sock"), MNEME_SPOOL: spool },
    });
    child.child.stdin?.end(stdin);
    await child;
    const spooled = drainSpool(spool);
    expect(spooled).toHaveLength(1);
    expect(spooled[0]?.kind).toBe("session-stop");
    expect(spooled[0]?.text).toContain("/home/operator/project");
  });

  it("exits 0 on malformed stdin and on events it does not observe", async () => {
    const dir = tmp("noop");
    const spool = join(dir, "spool");
    const env = { ...process.env, MNEME_SOCK: join(dir, "no.sock"), MNEME_SPOOL: spool };
    const garbage = run("node", [HOOK], { env });
    garbage.child.stdin?.end("{not json");
    await garbage;
    const other = run("node", [HOOK], { env });
    other.child.stdin?.end(JSON.stringify({ hook_event_name: "PreToolUse" }));
    await other;
    expect(existsSync(spool)).toBe(false);
  });
});

describe("a batch mixing channels", () => {
  it("senses file and claude-code packets side by side", () => {
    const emitter = makeEmitter();
    const packets: Observation[] = [
      {
        id: "standup.md",
        t: 1756000000002,
        channel: "file",
        kind: "note",
        text: "# Standup\nShipped the loader refactor.",
      },
      fixturePacket(),
    ];
    const { slots, flag } = senseBatch(kernel, packets, emitter);
    expect(flag).toBeNull();
    expect(slots.map((s) => s.obs.channel).sort()).toEqual(["claude-code", "file"]);
  });
});
