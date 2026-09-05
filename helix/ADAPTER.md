# Sensory adapters

Adapters are how the world reaches MNEME's sensory layer (brief §6: L0
stores = adapters, buffer, tools). An adapter observes one channel and
pushes **Observation packets**; the listener (`src/listen.ts`) accepts
them, feeds each batch to pg-s2w's declared ingress `raw`, and appends
the clean packets to a local sensory buffer file. When no listener is
running, the adapter spools the packet instead and the operator's
`bun run dogfood` runs that same pg-s2w pass over the spool before it
drains (see "Draining the buffer into memory"). That is the whole loop.
Nothing here commits long-term memory, and nothing here reads anything
back out — committing what the buffer holds is a separate,
operator-initiated tray drain.

This ships one real adapter — Claude Code hooks — plus the `file`
channel the desk tray already uses ([DOGFOOD.md](DOGFOOD.md)).

## The Observation packet

One wire schema, five fields, no other packet shape:

```json
{
  "id": "cc-1756000000000-4f9a01b2",
  "t": 1756000000000,
  "channel": "claude-code",
  "kind": "user-prompt",
  "text": "Add a unit test for the anomaly gate's card-number rule."
}
```

- `id` — unique per packet. Delivery is at-least-once; downstream memory
  is keyed, so a re-delivered id replaces rather than duplicates.
- `t` — Date-representable milliseconds since the Unix epoch, the adapter's own clock.
- `channel` — `file` or `claude-code` (the closed set for this slice).
- `kind` — what the channel saw: `note`, `user-prompt`, `session-stop`.
- `text` — the observed text, verbatim. Never parsed to route or branch.

The packet is the concrete shape this slice gives the kernel's opaque
`RawPacket` type on pg-s2w's ingress. It is a projection of the IR, not
an extension: the loader still mirrors `spec/kernel.json` verbatim.

## Starting the listener (optional)

```sh
cd helix
bun install
bun run listen
```

By default it listens on the unix socket `~/.mneme/helix.sock`, sweeps
the spool directory `~/.mneme/spool` every five seconds, appends clean
packets to `~/.mneme/buffer.jsonl`, and writes a `mneme.trace/v1` to
`helix/traces/listen.json` after every batch. Flags: `--sock`,
`--spool`, `--buffer`, `--out`, `--max-slots`, and `--once` (drain the
spool one time, write the trace, and exit — useful without a daemon).

The listener is optional. With no listener up, the hook spools every
packet, and `bun run dogfood` sweeps the spool through the identical
pg-s2w pass into the same buffer before it drains — so the daily loop
needs nothing long-running. Run the listener when you want packets
buffered as they arrive (and `helix/traces/listen.json` written per
batch) rather than at the next dogfood run.

Every batch is one pg-s2w invocation: normalize → salience → anomaly →
gate → bind, with the same deterministic secrets quarantine as the tray
(`src/anomaly.ts`). A quarantined packet version is dropped entirely —
never buffered, never logged verbatim. The listener's trace contains
`node.enter`/`node.exit`/`edge.fire`/`store.read` events only: no
`store.write`, no permits needed, and the printed checks fail the run if
an install, ack, or mint ever appears.

## Draining the buffer into memory

The listener (or the dogfood sweep standing in for it) only fills the
L0 buffer; nothing becomes long-term memory until the operator says so.
The hook never commits, the listener never commits, the sweep never
commits — committing is a tray run over what the buffer holds. The
Monday-afternoon loop is the hook plus one operator command
([DOGFOOD.md](DOGFOOD.md)):

```sh
cd helix
bun run dogfood                            # sweep the spool, drain buffer
                                           # and inbox together, then judge
bun run tray --buffer ~/.mneme/buffer.jsonl   # or drain just the buffer
                                              # (no sweep)
```

The drain feeds the buffered packets through exactly the write path
markdown notes take ([DOGFOOD.md](DOGFOOD.md)): pg-s2w re-screens every
packet at the anomaly gate, then pg-w2l consolidates under Core — one
`core.permit` consumed per `store.write`, with only the `audit.inbox`
report permit-exempt. A packet that survives the gate reaches the store
with its channel and declared kind remembered — unless the operator's
Core denies the commit (a per-item `core.deny` + `core.interrupt`; see
DOGFOOD.md's "The Core is a file you edit") — so `--ask` answers over
claude-code observations and desk notes alike; a quarantined packet's
id never appears among the trace's `store.write` keys.

The packet `id` is the memory key. Delivery is at-least-once and the
drain is idempotent: a re-delivered id in the buffer, or a re-run of the
whole drain, replaces the entry instead of duplicating it. The buffer
file itself is left in place — rotate or delete it whenever you like;
re-draining afterwards changes nothing.

## Installing the Claude Code hook

The adapter is `adapters/claude-code/hook.mjs` — dependency-free Node.
Add both events to `~/.claude/settings.json`, with the absolute path to
your clone. `bun run hook-snippet` prints exactly this block with your
clone's path filled in (it prints only; it never edits `~/.claude`) —
worth using, because a hook with a wrong path exits 0 like every other
failure and captures nothing, silently. `bun run status` the next
morning confirms packets arrived.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/Mneme/helix/adapters/claude-code/hook.mjs"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/Mneme/helix/adapters/claude-code/hook.mjs"
          }
        ]
      }
    ]
  }
}
```

On `UserPromptSubmit` the hook packages the submitted prompt as a
`user-prompt` packet; on `Stop` it records only that a session ended and
in which directory (`session-stop`). Other events observe nothing.

A `session-stop` packet is sensory punctuation, not long-term memory:
the salience stand-in scores it 0 from the packet's declared `kind`, and
the gate honours that score, so it may sit in the L0 buffer as a record
that a session ended but never binds into a working slot and never
reaches the store when the buffer is drained. Task chrome is not a user
prompt either: when the harness injects a literal `<task-notification>`
turn to report background work, the hook observes nothing at all — an
identity check on the exact prompt text (trimmed), not prose parsing,
and no further strings join that check without the steward. The
hook writes the packet to the socket and exits 0; if the socket is down
it spools the packet as one JSON file under `~/.mneme/spool` and still
exits 0 — the listener drains the spool when it is next up, or `bun run
dogfood` sweeps it at the next run. A hook must
never break the tool it observes, so every failure path exits 0, and it
prints nothing to stdout (on `UserPromptSubmit`, hook stdout would be
injected into the model's context). Environment overrides: `MNEME_SOCK`
and `MNEME_SPOOL`.

## Forbidden scrape

An adapter pushes what its own event payload carries, nothing more. The
Claude Code adapter must never:

- read `~/.claude/projects` or any transcript `.jsonl` file — the hook
  payload's `transcript_path` is deliberately ignored;
- call KOHO APIs or touch any KOHO system;
- emit `twin.install`, `steward.ack`, or `cap.mint` — adapters are
  sensors, not gates;
- write to any memory store — consolidation into long-term memory stays
  a separate, operator-initiated tray run, one `core.permit` per commit;
- parse packet text to decide routing — topology is the kernel's, not
  the prose's.

The test suite (`test/adapter.spec.ts`) pins the observable half of
this: the hook source contains no store write, a synthetic packet's
trace shows zero installs/acks/mints, and a packet carrying a credential
assignment is quarantined at the gate.

## Not in this slice

**Retrieve-on-submit is deliberately absent.** The `UserPromptSubmit`
hook only *observes*; it does not query memory and inject context back
into the session. That read path (query → hybrid → rerank → inject,
under Core) exists in the tray's `--ask`, and wiring it into the hook is
a separate, steward-gated step. Also out of scope here: twins, DEM, ADL,
desktop or Codex adapters, service units, and any rewrite of the
TypeScript runtime — the behaviour above is the whole loop.
