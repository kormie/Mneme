#!/usr/bin/env node
// Claude Code → MNEME sensory adapter (ADR-013 slice).
//
// Reads one Claude Code hook payload on stdin (UserPromptSubmit and Stop),
// writes one Observation packet to the listener's unix socket, and exits 0
// no matter what — a memory adapter must never break the tool it observes.
// If the socket is down, the packet is spooled as a JSON file for the
// listener to drain later, and the hook still exits 0.
//
// Boundaries: this adapter pushes only what the hook payload itself
// carries. It never reads the Claude Code projects directory or any
// transcript file, never calls a KOHO API, and never installs, acks, or
// mints anything — it is a sensor, not a gate, and it never writes to any
// memory store itself. It also prints nothing to stdout: on
// UserPromptSubmit, hook stdout would be injected into the model context.
import { connect } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const SOCK = process.env.MNEME_SOCK ?? join(homedir(), ".mneme", "helix.sock");
const SPOOL = process.env.MNEME_SPOOL ?? join(homedir(), ".mneme", "spool");

/** Map a hook payload to one Observation packet, or null to observe nothing. */
function packetFor(hook) {
  const t = Date.now();
  const base = { id: `cc-${t}-${randomUUID().slice(0, 8)}`, t, channel: "claude-code" };
  if (hook.hook_event_name === "UserPromptSubmit" && typeof hook.prompt === "string") {
    // Harness chrome, not the human: Claude Code injects a literal
    // "<task-notification>" turn when background work reports back. The
    // payload carries no field marking injected turns, so the sensor
    // drops that one exact text (trimmed) and observes nothing. This is
    // an identity check on the whole prompt, not prose parsing: no
    // other string is interpreted, and no denylist grows here without
    // the steward.
    if (hook.prompt.trim() === "<task-notification>") return null;
    return { ...base, kind: "user-prompt", text: hook.prompt };
  }
  if (hook.hook_event_name === "Stop") {
    // The Stop payload carries no content, and this adapter does not go
    // looking for any; the observation is only that a session ended here.
    return {
      ...base,
      kind: "session-stop",
      text: `claude-code session stopped (cwd: ${typeof hook.cwd === "string" ? hook.cwd : "unknown"})`,
    };
  }
  return null; // other events: nothing to observe in this slice
}

function spool(packet) {
  try {
    mkdirSync(SPOOL, { recursive: true });
    writeFileSync(join(SPOOL, `${packet.id}.json`), JSON.stringify(packet) + "\n");
  } catch {
    // Even a failed spool exits 0: dropping one observation is better
    // than breaking the operator's session.
  }
  process.exit(0);
}

function deliver(packet) {
  if (packet === null) process.exit(0);
  const sock = connect(SOCK);
  const giveUp = setTimeout(() => {
    sock.destroy();
    spool(packet);
  }, 500);
  sock.on("connect", () => sock.end(JSON.stringify(packet) + "\n"));
  sock.on("close", () => {
    clearTimeout(giveUp);
    process.exit(0);
  });
  sock.on("error", () => {
    clearTimeout(giveUp);
    spool(packet);
  });
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("error", () => process.exit(0));
process.stdin.on("end", () => {
  try {
    deliver(packetFor(JSON.parse(stdin)));
  } catch {
    process.exit(0);
  }
});
