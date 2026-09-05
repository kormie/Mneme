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
Results include the saved source, observation time, and an exact excerpt of up to 1,200
characters. The excerpt may be shorter than the original note, and it
does not imply that the source file still exists. Keep your originals
when you need the full text.

Recall does not synthesize several notes into an answer. Specific words
from a decision or topic are the most useful queries. Older stores
without excerpt or timestamp fields remain readable; remembering their
source again supplies the new fields.

## Commands

| Command | Use |
| --- | --- |
| `./mneme demo` | Run the isolated sample loop. |
| `./mneme capture "text"` | Save a note to the profile inbox. |
| `./mneme remember` | Process the configured inbox and sensory buffer. |
| `./mneme recall "query"` | Search remembered notes. |
| `./mneme recent --days 7 --limit 10` | Review recent remembered notes. |
| `./mneme status` | Show the profile and memory state. |
| `./mneme doctor` | Check the daily CLI setup. |
| `./mneme help` | Show available commands and options. |

Narrow a search by date or result count. Dates are inclusive local
calendar days:

```sh
./mneme recall "camping" --since 2026-09-01 --until 2026-09-07 --limit 10
```

Put double quotes inside the query to require a phrase:

```sh
./mneme recall '"borrowed stove"'
```

Phrases match a title, heading, or saved excerpt, with case and accents
folded. They cannot find prose beyond the saved excerpt unless it appears
in a title or heading. Ordinary search matches indexed words beyond that
excerpt too, up to the keyword cap.

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

The existing Claude Code adapter can supply an L0 sensory buffer. Follow
[ADAPTER.md](ADAPTER.md) to configure it. Its default buffer is
`~/.mneme/buffer.jsonl`, included by `remember` in the default profile.
You can choose both paths explicitly:

```sh
./mneme remember --buffer "$HOME/.mneme/buffer.jsonl"
./mneme remember --inbox "$HOME/notes/mneme-inbox" --buffer "$HOME/.mneme/buffer.jsonl"
```

`remember` can process both sources in the same run. Packet IDs identify
adapter observations; re-delivery replaces entries. The adapter captures
into the sensory buffer, and the operator's `remember` command commits
memory. Source files and buffer packets stay in place after remembering.
The daily CLI does not install or start the adapter.

## Profiles and storage

The default profile is `~/.mneme`:

| Path | Contents |
| --- | --- |
| `~/.mneme/inbox/` | Markdown notes saved by `capture`. |
| `~/.mneme/store.json` | Remembered entries, indexed words, and saved excerpts. |
| `~/.mneme/traces/` | Scheduler traces for inspecting memory operations. |
| `~/.mneme/buffer.jsonl` | Sensory buffer, when the optional adapter is configured. |

Use a separate profile to try changes or keep note collections apart:

```sh
./mneme --home "$HOME/mneme-weekend" capture "Camping list: bring the stove."
./mneme --home "$HOME/mneme-weekend" remember
./mneme --home "$HOME/mneme-weekend" recall "camping"
```

`MNEME_HOME` sets the default profile location for the shell; an explicit
`--home` takes precedence. Existing lower-level tray stores are not
automatically imported. Use `status` to confirm the active paths before
switching between the daily CLI and the older `bun run tray` or
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

The Core store is empty. There are no personal constitution clauses,
and the offline stand-in refuses steward-authored clauses it cannot
interpret. This tool's permit enforcement is not a configured personal
policy system.

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
- **A date search omits old entries:** older store entries may have no
  observation timestamp. Re-ingest their originals to populate it.

For low-level trace inspection and the existing dogfood feedback
questions, see [DOGFOOD.md](DOGFOOD.md).
