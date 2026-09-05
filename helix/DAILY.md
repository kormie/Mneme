# Daily memory

MNEME's daily CLI gives you a small, explicit memory loop: capture a note,
remember it, and recover its words later. It uses the existing Helix
graphs and local store. Prompt nodes run deterministic offline
stand-ins; there are no model or network calls.

## Setup

Use Bun **1.3.11 or newer**. Run these commands from the repository root:

```sh
bun install --cwd helix
./mneme doctor
./mneme demo
```

`demo` uses sample notes in an isolated temporary profile. It demonstrates
the write and read paths without importing anything from your existing
memory. Lean is required for contributor proof checks, not for daily use.

## Capture, remember, recall

```sh
./mneme capture "Desk setup: chose the north wall to avoid afternoon screen glare."
./mneme capture "Weekend: return the borrowed camping stove on Sunday."
./mneme remember
./mneme recall "screen glare"
./mneme recent --days 7
./mneme status
```

Capture saves a Markdown note in your profile inbox. It does not commit
to long-term memory. Run `remember` when you want the notes processed
through sensory → working → long-term memory. Each long-term write
consumes a separate `core.permit`; the prompt-audit report is the declared
permit-exempt `audit.inbox` write.

Pipe longer text or give a note a title:

```sh
printf '%s\n' 'Bring the folding chairs and return the borrowed stove.' |
  ./mneme capture --title "Weekend plan"
```

Recall runs `query → hybrid → rerank → inject` over the saved memory.
It matches titles, headings, saved excerpts, and a capped set of body
keywords, including accent-folded words, so `reunion` can find `réunion`.
Results include the saved source, observation time, and an exact excerpt
of up to 1,200 characters. The excerpt may be shorter than the original
note, and it does not imply that the source file still exists. Keep your
originals when you need the full text.

Recall does not synthesize several notes into an answer. Specific words
from a decision or topic are the most useful queries. Older stores
without excerpt or timestamp fields remain readable; remembering their
source again supplies the new fields.

## Commands

| Command | Use |
| --- | --- |
| `./mneme demo` | Run the isolated sample loop. |
| `./mneme capture "text"` | Save a note to the profile inbox. |
| `./mneme remember` | Process the configured inbox, sensory buffer, and hook spool. |
| `./mneme recall "query"` | Search remembered notes. |
| `./mneme recent --days 7 --limit 10` | Review recent remembered notes. |
| `./mneme status` | Show the profile and memory state. |
| `./mneme doctor` | Check the daily CLI setup. |
| `./mneme help` | Show available commands and options. |

Narrow a search by date or result count. Dates are inclusive local
calendar days:

```sh
./mneme recall "camping" --since 2026-09-01 --until 2026-09-07 --limit 10
./mneme recall "garden yesterday"
```

Relative periods such as `yesterday` or `last week` use today's local
date and the current UTC offset. The lower-level tray commands accept
an explicit `--as-of` date for reproducible queries. Use `--since` and
`--until` for local calendar boundaries across daylight-saving changes;
natural-language periods use the current offset throughout the interval.

Put double quotes inside the query to require its content words together:

```sh
./mneme recall '"borrowed stove"'
```

Quoted queries require every content word; unquoted queries can match
any query word. Case and accents are folded. The existing phrase scorer
checks adjacency in source names, titles, and headings, and gives those
matches more weight. It does not check adjacency in body excerpts, so a
body match is a match of words, not a guarantee of the exact phrase.
Ordinary search can match indexed words beyond the excerpt too, up to
the keyword cap.

For Markdown files, the observation time is the file's modification
time. Adapter observations use the timestamp recorded by the adapter.
These are source times, not dates inferred from the text of a note.
`recent` defaults to the last seven local calendar days, including today,
and ten results, newest first. `recall` defaults to five results. Both
support `--limit`.

Add `--json` to capture, remember, recall, recent, status, or doctor for
machine-readable output:

```sh
./mneme recall "camping" --json
```

## Bring your own notes

Point `remember` at a directory of `.md` files:

```sh
./mneme remember --inbox "$HOME/notes/mneme-inbox"
./mneme recall "meeting"
```

The inbox scan reads Markdown files directly inside the directory.
Subdirectories are not traversed. Files are identified by filename, so
keep filenames unique within a profile. Re-ingesting a file replaces its
entry instead of creating a duplicate. Editing the source file affects
memory only after another `remember` run; removing a source file does
not remove the remembered entry.

The existing Claude Code hook records prompts into the sensory buffer
when a listener runs, and otherwise into a spool directory. Follow
[ADAPTER.md](ADAPTER.md) to configure it, or install the hook once from
the repository root:

```sh
(cd helix && bun run install-hook --write)
```

This merges the hook into your Claude Code settings and keeps a backup.
The default `remember` reads `~/.mneme/buffer.jsonl` and the packets in
`~/.mneme/spool` alongside the profile inbox, so no listener daemon is
needed. Choose paths explicitly when your hook is configured elsewhere:

```sh
./mneme remember --buffer "$HOME/.mneme/buffer.jsonl"
./mneme remember --inbox "$HOME/notes/mneme-inbox" --spool "$HOME/.mneme/spool"
```

`remember` processes these sources together through the existing memory
graphs. Packet IDs identify adapter observations; re-delivery replaces
entries. Source files, buffer packets, and spool files stay in place
after remembering. It reads the profile's spool rather than implicitly
following `MNEME_SPOOL`; use `--spool` for a relocated hook.

### Agent notes use their own provenance

`capture` is for notes the operator writes. An agent recording a finding
uses the existing agent-note command from `helix/`:

```sh
cd helix
bun run remember "First line is a title
Then the finding, its source, and why it matters."
```

This queues an observation declared as `claude-code/agent-note`. It does
not commit memory. The next `./mneme remember` from the repository root
or `bun run dogfood` from `helix/` considers it through the graph, using
the corresponding store. A Core with `human-utterance-only` refuses
agent-note writes by design. These two commands deliberately have
different meanings: **`bun run remember` queues an agent note;
`./mneme remember` commits the profile's queued sources.** See
[DOGFOOD.md](DOGFOOD.md) for the established agent and journal workflow.

## Profiles and storage

The default profile is `~/.mneme`:

| Path | Contents |
| --- | --- |
| `~/.mneme/inbox/` | Markdown notes saved by `capture`. |
| `~/.mneme/store.json` | Remembered entries, indexed words, and saved excerpts. |
| `~/.mneme/traces/` | Scheduler traces for inspecting memory operations. |
| `~/.mneme/buffer.jsonl` | Sensory buffer, when the optional adapter is configured. |
| `~/.mneme/spool/` | Queued hook and agent-note packets, read by `remember`. |
| `~/.mneme/core.json` | Optional steward-authored write policy; only the steward edits it. |

Use a separate profile to try changes or keep note collections apart:

```sh
./mneme --home "$HOME/mneme-weekend" capture "Camping list: bring the stove."
./mneme --home "$HOME/mneme-weekend" remember
./mneme --home "$HOME/mneme-weekend" recall "camping"
```

`MNEME_HOME` sets the default profile location for the shell; an explicit
`--home` takes precedence. Each profile reads its own `core.json`; a new
profile does not copy your existing policy. The daily CLI uses
`~/.mneme/store.json` and `~/.mneme/inbox/`; the established tray defaults
are `helix/store/tray.json` and `~/mneme-tray`. Existing tray stores are
not automatically imported. Use `status` to confirm active paths before
switching between the daily CLI and the `bun run tray` or
`bun run dogfood` commands documented in [DOGFOOD.md](DOGFOOD.md).

The store is plain JSON. Inbox files and adapter buffers can contain the
full original text. Traces record scheduler events and memory keys.
Each memory run saves a new trace; recall and recent replace their own
latest trace files.
Copy your profile directory to back it up, and keep copies of any source
notes or adapter buffer stored elsewhere.

## Reading the result honestly

A deterministic scan quarantines notes matching known secret patterns
before the current version enters working or long-term memory. The
command identifies the rule, so you can edit the note and remember it
again. A previously committed clean version remains remembered. A clean
scan means only that none of its rules matched; keep credentials,
customer data, and production secrets out of the inbox.

The CLI loads the profile's steward-authored `core.json` before a memory
run and never writes it. A missing file means an empty Core, which
constrains no writes. An unreadable, malformed, or wrongly shaped file
aborts rather than silently disabling policy. The implemented
`human-utterance-only` value refuses writes whose declared kind is not
`note` or `user-prompt`; this trusts the adapter's provenance declaration.
Unknown values fail closed at command startup and again when a write is
evaluated. The `prose` field
is documentation for the steward, not an executable rule. Core changes
gate future writes; previously remembered entries remain readable.

The printed checks are untrusted TypeScript checks of the emitted
trace. The current project is judged and certified static; it has no
accepted `RuntimeCertificate`. `HasClusterCut` and `HasArchiveSample`
remain unmet because this path runs neither ADL nor DEM. Runtime
certification awaits the steward's next spec pack resolving `tau`.
See [JUDGE.md](JUDGE.md) for the exact certificate and toolchain scope.

## Troubleshooting

- **Bun is missing or too old:** install or update Bun, then run
  `bun install --cwd helix` and `./mneme doctor` from the repository root.
- **Nothing to recall:** run `remember` after `capture`, check `status`
  for the active profile, and try a distinctive word from the note.
- **A note is quarantined:** use the printed rule to clean its source,
  then run `remember` again.
- **Core refuses an agent note:** this is expected with
  `human-utterance-only`. The steward decides the policy; an agent must
  not relabel the note as human-authored to bypass it.
- **A date search omits old entries:** older store entries may have no
  observation timestamp. Re-ingest their originals to populate it.

For low-level trace inspection and the existing dogfood feedback
questions, see [DOGFOOD.md](DOGFOOD.md). Features requiring a steward
decision are tracked in [PROPOSALS.md](PROPOSALS.md).
