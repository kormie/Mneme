---
name: dogfood-loop
description: Runs MNEME's documented "Monday-afternoon loop" (helix/DOGFOOD.md) — makes sure the sensory listener is running, drains it with the one operator command, and surfaces the resulting mneme.trace/v1 judge summary. Use when the user asks to "dogfood", "run the dogfood loop", "drain the buffer", or check in on their own MNEME notes.
---

# Dogfood loop

The documented loop (`helix/DOGFOOD.md`, "Daily use: the Monday-afternoon
loop") is two pieces: **listen** (already running, filling the L0 buffer —
`helix/ADAPTER.md`) plus **one operator command**, `bun run dogfood`. This
skill does both, in order, from `helix/`.

This is a local-only laptop tool for the operator's own notes: no network
calls, no model calls, nothing becomes long-term memory except through the
one permit-gated write path `bun run dogfood` runs.

## Steps

1. **Check whether the listener is already running.**

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

2. **If it is not running, start it in the background from `helix/`.**

   ```sh
   cd helix
   bun install
   bun run listen
   ```

   Start this with the Bash tool's background mode (or `nohup ... &
   disown` outside Claude Code) so it keeps running after this step
   returns — it is a long-lived daemon, not a one-shot command. By
   default it listens on `~/.mneme/helix.sock`, sweeps
   `~/.mneme/spool` every five seconds, appends clean packets to
   `~/.mneme/buffer.jsonl` (or legacy `~/.mneme/buffer.ndjson` when it
   contains packets and `buffer.jsonl` does not), and writes a trace to
   `helix/traces/listen.json` after every batch. Do not start a second
   listener if one is already running.

3. **Run the one operator command.**

   ```sh
   cd helix
   bun run dogfood
   ```

   This first loads the operator's Core file (`~/.mneme/core.json`;
   missing means an empty Core, malformed or unimplemented values abort
   before any drain), then resolves the source itself (buffer first,
   inbox fallback to `~/mneme-tray`), drains it through the
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
