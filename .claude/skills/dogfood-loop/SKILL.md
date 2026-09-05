---
name: dogfood-loop
description: Runs MNEME's documented "Monday-afternoon loop" (helix/DOGFOOD.md) — runs the one operator command (which sweeps the hook's spool itself, so no listener daemon is needed) and surfaces the resulting mneme.trace/v1 judge summary. Use when the user asks to "dogfood", "run the dogfood loop", "drain the buffer", or check in on their own MNEME notes.
---

# Dogfood loop

The documented loop (`helix/DOGFOOD.md`, "Daily use: the Monday-afternoon
loop") is two pieces: the **Claude Code hook** (installed once —
`helix/ADAPTER.md`) plus **one operator command**, `bun run dogfood`. The
command sweeps the hook's spool through pg-s2w into the L0 buffer itself
before draining, so a listener daemon is optional: run this skill from
`helix/` and it works whether or not `bun run listen` is up.

This is a local-only laptop tool for the operator's own notes: no network
calls, no model calls, nothing becomes long-term memory except through the
one permit-gated write path `bun run dogfood` runs.

## Steps

1. **(Optional) Check whether a listener is already running.** A running
   listener buffers packets live; without one, the hook has been spooling
   and step 3 sweeps the spool. Neither case needs anything started here.

   ```sh
   pgrep -f "src/listen.ts" >/dev/null 2>&1 && echo "listener: running" || echo "listener: not running"
   ```

   (Match on `src/listen.ts`, not `helix/src/listen.ts` — `bun run listen`
   invokes it as `bun src/listen.ts` relative to `helix/`, with no `helix/`
   prefix in the process's own cmdline, so an anchored pattern that
   includes the prefix never matches and this check would falsely report
   "not running" every time.)

   (A stale `~/.mneme/helix.sock` file can exist with no process behind
   it — trust the process check, not just socket-file presence.)

2. **Do not start a listener on the user's behalf.** Only start
   `bun run listen` (Bash background mode, from `helix/`) if the user
   explicitly asks for live buffering; it is a long-lived daemon, and
   the dogfood command below does not depend on it. Never start a
   second listener if one is already running.

3. **Run the one operator command.**

   ```sh
   cd helix
   bun run dogfood
   ```

   This first loads the operator's Core file (`~/.mneme/core.json`;
   missing means an empty Core, malformed or unimplemented values abort
   before any drain), sweeps `~/.mneme/spool` through pg-s2w into
   `~/.mneme/buffer.jsonl` (the listener's `--once` pass; quarantined
   packets are dropped, never buffered), then resolves the source itself
   (the buffer and the `~/mneme-tray` inbox together), drains it through the
   permit-gated write path (one `core.permit` per `store.write`, only
   `audit.inbox` exempt; commits the Core denies are refused per item
   and reported in the digest), writes the store and
   `helix/traces/dogfood.json`, and runs the untrusted judge over that
   trace.

4. **Surface the judge summary to the user.** Report, from the command's
   output:
   - The safety verdict (must pass for exit 0).
   - The two liveness gaps, `HasClusterCut` and `HasArchiveSample` — these
     must stay **fail**; this slice never runs pg-adl or pg-dem, and a pass
     here would mean a stuffed trace, not progress.
   - The three feedback prompts DOGFOOD.md asks the operator to answer for
     Kormie (@kormie): *Useful? Creepy? Missing Core clause?*
   - Exit code: `0` means the drain (or an explicit "nothing to drain" when
     both buffer and inbox were empty) and the judged safety laws held;
     `1` is either a refused constitution (stderr names the core file or
     an uninterpretable core value — fix `~/.mneme/core.json` and rerun)
     or a safety fail — report a safety fail as a regression, not
     something to silently retry.

Do not invent events, do not edit the trace, and do not treat "judge
fail=0" as a certificate (ADR-008) — it is empirical, not proof.
