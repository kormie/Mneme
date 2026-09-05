# Desk-tray dogfood

For the `./mneme` front door, sample demo, and daily profiles, start with
[DAILY.md](DAILY.md). This guide documents the established lower-level
tray commands, whose default store is `helix/store/tray.json`; the daily
CLI uses `~/.mneme/store.json` and does not automatically import it.

A small, local-only flavour of MNEME you can run on your own desk notes.
You drop markdown files into an inbox directory; the Helix scheduler runs
the declared kernel graphs over them (sensory → working → long-term, with
a secrets quarantine at the gate, one Core permit per commit, and a
prompt-corpus audit at the end), remembers them in one local JSON file,
and writes a `mneme.trace/v1` you can read line by line. `--ask` runs the
declared read path over that memory, so last week's notes answer this
week's questions. The behaviour is deterministic: the same inbox, the
same starting memory, and the same Core file produce byte-identical
output — your constitution is an input to determinism, not a mood.

This is a laptop tool for the operator's own notes. It is not a KOHO
product feature and touches no KOHO system.

Notes you drop by hand are the `file` channel. Live channels — Claude
Code sessions today — arrive through the sensory adapter loop instead
([ADAPTER.md](ADAPTER.md)): the hook delivers each packet to the
listener when one is running, and spools it to a directory when none
is; the listener fills an L0 buffer file, and `bun run dogfood` sweeps
the spool into that same buffer itself, so no daemon is required.
`--buffer` drains the buffer through the very same write path as the
inbox. Either way, nothing becomes memory except by a tray run you
started, one `core.permit` per commit.

## What it is, and is not

- **Local-only. No network.** The CLI reads files in the inbox directory
  and the spec pack in this repository, and writes one trace file. It
  makes no network calls, no model calls, and sends nothing anywhere.
  Prompt nodes run deterministic offline stand-ins.
- **The inbox is files the human dropped.** Nothing is watched, scraped,
  or synced. If you did not put a file in the inbox directory yourself,
  the tray never sees it.
- **The Core is a file you edit.** No agent authored constitution
  clauses on your behalf: your Core lives at `~/.mneme/core.json`
  (`--core` relocates it), shaped exactly
  `{ "values": [], "goals": [], "prose": "" }`, and only you write it —
  never the listener, never the hook, never a drain. A missing file is
  an empty Core; a file that is malformed or wrongly shaped aborts the
  run before any drain, because a constitution must never be silently
  disabled. One JSON caveat the loader cannot see: a duplicated key
  keeps only its last occurrence, so never repeat a key in this file. An empty constitution constrains nothing, so everything
  that passed salience still commits, each write under its own
  `core.permit` — exactly the behaviour before the file existed.
  `values` is a closed enum of steward-named switches; the first and
  only one implemented is `human-utterance-only`, which refuses any
  commit whose declared provenance kind is not `note` or `user-prompt`
  (defence in depth at Core, on top of the salience gate that already
  keeps session chrome out of working memory). One honest limit: the
  switch trusts the kind your adapters declared — the hook is the trust
  anchor, and nothing re-verifies authorship at write time. Under
  today's deterministic stand-ins that declaration survives the graph
  faithfully; a sealed provenance channel is 0.11 work, due before any
  model-backed extraction ships. A denied write is a
  per-item `core.deny` + `core.interrupt` on the trace — the rest of
  the drain continues — and a value the stand-in does not implement
  makes it throw rather than pretend to interpret a clause it cannot
  honour. `prose` is your own words about those values: the tray never
  interprets it and it never enters the IdentitySnapshot, so write
  whatever helps you remember what the switch is for.
- **Memory is one JSON file you own.** Commits persist to
  `helix/store/tray.json` (or wherever `--store` points): open it, copy
  it, delete it, and the memory is inspected, backed up, or gone.
  Re-ingesting a note replaces its entry, so running the tray twice never
  duplicates anything. The steward inbox still exists only as trace
  events. The printed checks are slice-local, untrusted TypeScript: the
  full temporal law set (`Mneme.Trace.Temporal`) also requires ADL and
  DEM activity (`cluster.cut`, `archive.sample`) that this tray
  deliberately never produces, and no concrete tray trace has been
  imported into Lean yet. That import is the roadmap's endgame, not a
  thing this tool already claims.
- **The inbox refuses secrets.** A deterministic scan (the `anomaly`
  node's offline stand-in) quarantines notes containing credential
  assignments, AWS access key ids, private-key blocks, card numbers that
  pass a Luhn check, or KOHO hostnames. A flagged note's current version
  never enters working memory, the store, or the trace's write keys —
  the run tells you which rule fired so you can edit the note and
  re-run. If an earlier, clean version of that note was committed
  before, it stays remembered until you re-ingest the cleaned note or
  delete the entry from the store file. A clean scan is not a guarantee;
  it only means no rule matched, so keep customer data and production
  secrets out of your notes regardless.

## Agent notes: remembering on purpose

An agent working in this repo (or you, at a terminal) can record one
observation deliberately:

```sh
bun run remember "First line is the title, at most 120 characters
Then why, the file, and the test that pins it."
```

That spools one Observation packet with declared provenance —
`channel: claude-code`, `kind: agent-note` — exactly as the hook spools
when no listener is up, and stops: it writes no store, runs no graph,
reads nothing back. The note enters memory only on the next
`bun run dogfood`, through the secrets gate and one `core.permit` per
write, and a `human-utterance-only` Core refuses it with a per-item
`core.deny` by design. Agents author candidates; your Core decides.
`helix/fixtures/agent-notes/` holds dated files of such notes about this
codebase that earlier sessions recorded; a fresh clone drains one with
`bun run tray --buffer fixtures/agent-notes/<file>.jsonl` and can then
ask before it edits. The routine an agent follows is the `recall` skill
in `.claude/skills/`; nothing in it runs at session start on its own or
injects memory into a session automatically — that is retrieve-on-submit,
steward-gated ([PROPOSALS.md](PROPOSALS.md)).

## Forbidden in this dogfood

Do not put any of these in the inbox, and the tool must never grow them:

- Customer PII of any kind — names, account numbers, card numbers (PAN),
  balances, contact details.
- Production secrets, credentials, tokens, or internal production URLs.
- Sending mail or messages of any kind.
- Silent installs of anything; there is no `twin.install`, no
  `steward.ack`, no `cap.mint` in the trace, and the tests assert that.
- Twins, DEM, ADL, a chat UI, or an explorer UI (out of the ADR-013
  slice).
- Calls to KOHO APIs or any KOHO production system.

If a run's printed checks ever report one of the "absent" counters as
non-zero, that is a regression to report, not a feature.

## How a KOHO teammate runs it

You need Bun 1.3+ and a clone of this repository. Nothing else.

```sh
cd helix
bun install
mkdir -p ~/mneme-tray            # your inbox, anywhere you like
cp fixtures/tray/*.md ~/mneme-tray   # or drop your own notes in
bun run tray --inbox ~/mneme-tray
```

Running it with no arguments uses the checked-in fixtures:

```sh
bun run tray                     # equivalent: bun src/tray.ts
```

The run prints a per-note digest (and anything quarantined), commits to
the local store, and writes `helix/traces/tray.json`. Open the trace and
read it: every event names a node or edge that exists in
`spec/kernel.json`, every long-term `store.write` sits immediately after
its own `core.permit`, and the one `audit.inbox` write is permit-exempt
by law. The checks printed are untrusted TypeScript mirrors of the Lean
predicates in `spec/lean/Trace.lean`; the Lean build remains the
artifact of record (ADR-008).

## Daily use: the Monday-afternoon loop

The whole loop is two pieces: the **Claude Code hook** (installed once,
[ADAPTER.md](ADAPTER.md)) plus **one operator command**:

```sh
bun run dogfood                  # equivalent: bun src/tray.ts --dogfood
```

No daemon is required. When no listener answers the hook's socket, the
hook spools each packet as one JSON file under `~/.mneme/spool`, and
`bun run dogfood` starts by sweeping that spool through pg-s2w into
`~/.mneme/buffer.jsonl` — the listener's own `--once` pass, run for you,
with the same secrets quarantine (a flagged packet is dropped, never
buffered). If you do keep `bun run listen` running, the hook delivers to
it directly and the sweep simply finds an empty spool; both paths end in
the same buffer, so nothing is counted twice.

One run, no flags: it loads your Core file first (`~/.mneme/core.json`;
missing means an empty Core, malformed aborts before any drain) and
prints which constitution applied; sweeps the spool as above; reads
everything in `~/.mneme/buffer.jsonl` and every markdown note in the
documented inbox default `~/mneme-tray` (notes you dropped by hand) —
a day's typed prompts and a day's dropped notes are one backlog, drained
together, buffer first — through
the one permit-gated write path (one `core.permit` consumed per
`store.write`, only the `audit.inbox` report permit-exempt); writes the
store and a `mneme.trace/v1` to `helix/traces/dogfood.json` — one trace
for the whole command, the sweep's sensory events included; runs the
untrusted judge over that trace and prints the safety verdict alongside
the two liveness gaps (`HasClusterCut`, `HasArchiveSample`), which must
stay **fail** — this slice never runs pg-adl or pg-dem and stuffs no
events; and finishes with the three feedback prompts below. Exit 0 when
the drain and the judged safety laws hold; exit 1 on any safety fail.
When spool, buffer and inbox are all empty it prints "nothing to drain"
and exits 0 — no write is invented for an uneventful Monday (a sweep
that quarantined everything still writes its sensory-only trace, so the
quarantine is on the record). The hook still never commits, and
retrieve-on-submit is still absent; nothing becomes memory except by
this command, run by you.

What the drain commits is what you observed, never the session's own
chrome. A Claude Code `session-stop` packet is sensory punctuation: the
listener may buffer it (observe), but the salience stand-in scores it 0
and the gate honours the score, so it never binds into working memory
and its id never appears in a `store.write` key, an episode, or a
triple. The harness's injected `<task-notification>` turns are task
chrome, not user prompts: the hook never observes them at all
([ADAPTER.md](ADAPTER.md)).

Working memory is a declared budget per sensory→working pass (64
slots by default; `--max-slots` changes it on any drain). A backlog
larger than that — a week of Claude Code prompts — is perceived in
rounds: one pg-s2w pass and one pg-w2l pass per 64 packets, in buffer
order, each `store.write` still under its own `core.permit`, and
pg-audit once after the last round. Nothing past the budget is dropped
or held back for a later run; the trace simply shows one graph pair per
round.

`--spool`, `--buffer`, `--inbox`, `--store`, `--out`, `--core`, and
`--max-slots` relocate or resize those defaults when you keep your tray
(or your constitution) elsewhere. The single-source drains remain for
when you want just one side (they read one file and never sweep, so
`--spool` is refused on them; `--dogfood` and `--status` both take it):

```sh
# during the day: standups, PR review notes, CI post-mortems,
# "follow up with X", git log summaries — one markdown file each
$EDITOR ~/mneme-tray/$(date +%F)-standup.md

# ingest one source explicitly (idempotent — rerun any time; packet
# ids and note names are the memory keys)
bun run tray --inbox ~/mneme-tray
bun run tray --buffer ~/.mneme/buffer.jsonl

# later, from memory:
bun run tray --ask "what did I write about Jordan?"
bun run tray --ask "CI flake"
bun run tray --ask "what happened last week?" --as-of 2026-09-07
bun run tray --ask "what did I write about deployment last week?" --as-of 2026-09-07
bun run tray --ask "what did I ask yesterday" --as-of 2026-09-05 --utc-offset -04:00
bun run tray --ask "canary on 2026-09-02"
bun run tray --ask "between 2026-09-01 and 2026-09-03"

# or as a day-by-day journal (the morning command):
bun run journal "yesterday" --as-of 2026-09-05 --utc-offset -04:00
bun run journal "this week" --as-of 2026-09-05
bun run status                   # is the loop alive? what is waiting?
```

The journal is the morning command. `bun run journal "yesterday"
--as-of 2026-09-05 --utc-offset -04:00` runs the same read path as
`--ask` and renders the result as days: one header per calendar day in
the offset you gave, one line per remembered observation in ascending
time — `19:30  claude-code/user-prompt  cc-…  "Ship the canary fix…"` —
with `file/note` lines for dropped notes alongside. Topic words filter
it (`bun run journal "canary this week" --as-of …`) and show what
matched; `--limit` caps the lines. The journal needs a period; it never
shows session-stop punctuation, because that is never remembered, and
it writes the same read-only trace `--ask` does.

Add `--json` to `--ask` or `--journal` when another local tool needs
structured results instead of prose. This changes presentation only:
the declared read path, trace bytes, and underlying hit order stay the
same. `--limit` caps the returned `hits` or `entries`, and `omitted`
reports how many results remain. Journal entries retain the ascending
display order described above. Ask JSON defaults to five hits, matching
the prose view; journal JSON defaults to all entries. The `limit` field
always reports the effective cap.

Ask mode runs the declared pg-w2l read path (`query → hybrid → rerank →
inject`) over your store — deterministic lexical retrieval across note
names, titles, headings, and extracted triples; no model, no network,
and its trace (`helix/traces/ask.json`) contains no `store.write` and
needs no permit. A note is remembered by its filename, title, headings,
and a capped bag of its body keywords — accent-folded, so "reunion"
finds "réunion". Titles and headings are kept as you wrote them: the
title is the first heading of any level when there is one, and every
second-level-or-deeper heading (`##` to `######`) is stored whole,
because you wrote those lines as summaries; a later `#` line is body
text. A
heading-less packet (every ordinary Claude Code prompt) has no summary,
so its first line stands in, clipped at 120 characters on a word
boundary. The store also keeps an exact source excerpt of up to 1,200
characters alongside the capped keyword bag. Older entries without an
excerpt remain readable; re-ingesting the source supplies one. `--store`
points both modes at a different memory file if you want separate trays.

Dates are explicit deterministic inputs; Helix never consults the wall
clock for a query. A question may name one period:

| Phrase | Needs | Interval (half-open) |
| --- | --- | --- |
| `today` | `--as-of D` | `[D, D+1 day)` |
| `yesterday` | `--as-of D` | `[D−1 day, D)` |
| `this week` | `--as-of D` | the calendar week holding D, Monday to Monday |
| `last week` | `--as-of D` | the calendar week before that |
| `this month` | `--as-of D` | the calendar month holding D |
| `last month` | `--as-of D` | the calendar month before that |
| `on YYYY-MM-DD` (or a bare date) | nothing | that day |
| `between A and B` / `from A to B` | nothing | both days inclusive |

`D` is a calendar day in the offset you give, so pair a local date
with a local offset (`--as-of "$(date +%F)" --utc-offset -04:00`) and a
UTC date with UTC days (`--as-of "$(date -u +%F)"`). Periods are
calendar units, never rolling windows: `last week` with
`--as-of 2026-09-07` selects observation times in
`[2026-08-31T00:00:00Z, 2026-09-07T00:00:00Z)`, and so does a Wednesday
`--as-of 2026-09-09`. Day boundaries fall at midnight UTC unless
`--utc-offset ±HH:MM` says otherwise — an explicit fixed offset is a
deterministic input, not a clock read, so `--utc-offset -04:00` makes a
9 PM prompt in Rhode Island land on the day you typed it; a fixed
offset ignores daylight saving by design, so pick the offset in force
for the days you are asking about. The period phrase is recognised and
removed before the lexical match, so "yesterday" or a date literal never
becomes a required word. Supplying `--as-of` or `--utc-offset` without a
recognised period fails rather than silently returning an unbounded
result; naming two periods, two loose dates, or an impossible date fails
too. Pure temporal questions return every dated record in the interval;
adding topic words also requires the existing accent-folded lexical
match. A word in a note's name, title, or a heading counts double, a
word from its body keyword bag counts once, a query word of four or more
letters also matches stored words it begins ("deploy" finds
"deployment", shown as `deploy→deployment`), and provenance — channel,
kind, observation time — is never content, so "claude" does not match
every prompt. Every result sorts by that score, then newest observation
first (undated records last), then source-note id, so the latest thing
you said about a topic comes first. A quoted phrase (`--ask '"code
review"'`) requires every one of its words; when the phrase appears
as you wrote it in a note's name, title, or a heading the hit says
"adjacent" and scores higher, and when its words are only in the body
keyword bag the hit says so. Body excerpts are saved for lexical recall
and display; the existing phrase scorer does not check adjacency in
them. A phrase made only of small words
("last week", as words someone wrote) can only match adjacently. The
wall clock stays in your shell: an alias such as
`alias ask-today='bun run tray --as-of "$(date -u +%F)" --ask'` keeps
the run itself reproducible.

The displayed date is **observation time**, not the date of an event in
the note and not a claimed authorship time. Adapter-buffer packets carry
the adapter's clock reading; markdown inbox notes use file modification
time as of the latest drain. Editing or copying a file therefore re-dates
its keyed record and does not retain the earlier time. Git does not
preserve mtimes, so shipped fixtures are observed when checked out; tests
that depend on observation time set it explicitly. Like `kind`, time is
adapter-attested rather than independently verified and currently rides
through prompt-owned triples; the sealed sidecar remains deferred to the
steward's 0.11 pack. Helix does not infer dates from prose. Stores written
before observation time was persisted remain readable without migration:
their undated records participate in ordinary lexical retrieval but are
reported and excluded from time-bounded results. Ask mode never rewrites
the store, and the spec-bound trace vocabulary does not record `--as-of`
or the derived interval.

## Roadmap and known debt

Landed so far, in order (KOHO's stack — git, GitHub CI, TypeScript, Go,
Python, Terraform, Claude Code — is fertile inbox material, but MNEME
must stay the operator's own memory, never a repo indexer; brief §11
refuses the Graft shape outright):

1. ✅ **Anomaly gate for secrets** — the `anomaly` node's stand-in scans
   deterministically and quarantines via the declared `e4` control edge.
2. ✅ **More note flavours** — CI post-mortems and git day summaries ship
   as fixtures; anything you write as markdown works.
3. ✅ **The read path** — `--ask` runs `query → hybrid → rerank → inject`
   over the persistent store.
4. ✅ **The buffer drains** — `--buffer` commits what the adapter
   listener buffered, through the same permit-gated write path as the
   inbox; entries remember their channel, and packet ids are the memory
   keys, so re-delivery and re-drains replace instead of duplicating.
   The hook still never commits, and retrieve-on-submit is still absent
   (ADAPTER.md).
5. ✅ **The Monday-afternoon command** — `bun run dogfood` resolves the
   sources (buffer and inbox together), drains them under consume-once
   permits, judges the emitted trace with the untrusted judge (safety
   must pass; the two liveness gaps must stay fail), and prints the
   three feedback prompts. Empty sources drain nothing and invent no
   write.
6. ✅ **The Core file and its first switch** — the drain loads your
   `~/.mneme/core.json` and runs `human-utterance-only` when you name
   it: commits whose declared kind is not `note` or `user-prompt` are
   denied per item (`core.deny` + `core.interrupt` on the trace, the
   drain continues), and episodes and triples now carry that declared
   `kind`. A proposal missing its `kind` reads as unknown — refused
   under the switch if it ever reaches the filter, passed under an
   empty Core. The switch is prospective: it gates writes, not what
   memory already holds, so entries committed before you flipped it
   stay remembered and stay answerable through `--ask` until you
   re-ingest or delete them. Safety and liveness claims are unchanged:
   the same laws hold, the two liveness gaps still must stay fail, and
   there is still no RuntimeCertificate.

7. ✅ **`last week` retrieval under an explicit `--as-of`.** Observation
   time now survives both ingest channels and the declared write/read
   graph. Queries return source notes and stored facts without fabricating
   a narrative. Since extended to today, yesterday, this/last week,
   this/last month, absolute days and inclusive ranges, with an explicit
   fixed `--utc-offset` for day boundaries.
8. ✅ **No daemon required.** `bun run dogfood` sweeps the hook's spool
   through pg-s2w into the buffer before draining — the listener's
   `--once` pass, run by the one operator command — so the loop is the
   hook plus that command. The listener stays available for anyone who
   wants packets buffered live.
9. ✅ **Backlogs drain completely.** A drain larger than the
   working-memory budget used to commit its first 64 packets and report
   the rest as deferred, with no way to ingest them from a buffer; it now
   runs the declared graphs in rounds of 64 until the backlog is
   perceived, pg-audit once at the end.

10. ✅ **Reading memory like a person would.** `bun run journal` renders
    a period as days; a word in a name, title, or heading counts double,
    query words match stored words they begin, quoted phrases require
    every word and say whether they were adjacent, provenance never
    matches as content, and ties list the newest first.
    `bun run status` says what is waiting and what memory holds without
    running anything; `bun run hook-snippet` prints the one block the
    hook install needs; the digest counts unchanged re-commits on one
    line; buffer and inbox drain together; a heading-less title is
    clipped at ingest so the store keeps a handle, not a prompt.

Next, in rank order:

11. **Steward decisions, written up.** [PROPOSALS.md](PROPOSALS.md)
    holds the daily-loop asks this slice must not build alone —
    retrieve-on-submit, a packet `origin` (which repository a prompt
    came from), a git commit-message channel, buffer rotation, the
    title-clip policy, and where real multi-note synthesis belongs —
    each as the smallest diff against the IR or the adapter contract,
    each naming its gate and what it needs from Kormie.
12. **Steward-gated proposals only.** Richer structural edges live in the
    frozen `structural` transform, and this whole domain belongs to the
    `agora` twin eventually — both go to Kormie as graph diffs, not code.

Known Helix debt (acknowledged, not hidden): a cyclic edge re-arms only
its direct target, so a rerun of `rehearse` would not yet re-run the
downstream write pipeline; appliers are part of the trusted computing
base and nothing binds a stand-in's body to the node's `bodyHash` — the
trace records what this process logged, and only steward review of a
pinned revision closes that.

## Feedback we want

Send answers (or a screenshot of your run) to Kormie (@kormie):

1. **Useful?** Did the per-note digest and the trace tell you anything
   about your own notes that a folder listing would not have?
2. **Creepy?** Was there any moment the tray felt like it overstepped —
   read too much, inferred too much, or kept something you did not expect
   it to keep? (The prose it keeps includes headings, a heading-less
   packet's first line clipped at 120 characters, and an exact source
   excerpt of up to 1,200 characters; say if that is too much, or too
   little to recognise a prompt by.)
3. **Missing Core clause?** With an empty Core every commit passed;
   `human-utterance-only` is the first switch you can flip in your own
   `core.json`. What is the next clause you wished had been there to
   stop or reshape a write? Phrase it in your own words — the `prose`
   field is exactly for that phrasing, and it is never executed; the
   steward, not an agent, decides what becomes a `values` switch.
