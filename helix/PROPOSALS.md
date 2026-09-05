# Proposals for the steward

Things the daily loop wants that this slice must not build on its own.
Each is written as the smallest diff against the kernel IR or the
adapter contract, with the gate it crosses named up front and the
failure modes spelled out, so Kormie can accept, reshape, or refuse it
without re-deriving the context. None of these is implemented. Every
one requires Kormie. Nothing here is a certificate claim.

The rule that separates this file from the code: a helix-level contract
(a CLI default, a digest format, what the tray's own stand-ins keep) may
change in a PR with same-commit doc updates and a clear flag in the PR
description; anything on AGENTS.md's steward-gate list, the
retrieve-on-submit gate in ADAPTER.md, the five-field Observation
packet, or the closed channel set does not. The first kind lands in
code; the second kind lands here.

## 1. Retrieve-on-submit

**What:** the `UserPromptSubmit` hook runs the declared pg-w2l read
path (`query → hybrid → rerank → inject`) over the operator's store and
prints the injected slots to stdout, which Claude Code adds to the
model's context for that turn — last week's notes answering this
week's prompt without the operator asking.

**Gate:** explicitly steward-gated in ADAPTER.md ("wiring it into the
hook is a separate, steward-gated step"). Hook stdout on
`UserPromptSubmit` is model context, so this is the first path by which
memory shapes a session, and it must run under Core: an IdentitySnapshot
on the read path's `identity` ingress, with `rerank` as the
Core-constrained prompt node it is declared to be.

**Minimal diff:** no IR change. A second adapter entry point (or a flag
on `hook.mjs`) that, after spooling the observation as today, runs the
same `runAsk` the tray uses with the prompt as the question and writes
`inject.slots` as a short block on stdout. The hook keeps every other
property: exits 0 on every failure, never reads transcripts, never
commits.

**Failure modes to decide on first:** (a) latency — a synchronous read
path on every prompt; a budget and a kill switch belong in Core, not in
a prompt file; (b) what gets injected is tokens and clipped titles, not
prose, so the model sees keys and summaries, which may be exactly right
or may be noise; (c) the injected block is itself a user-prompt-shaped
input the next hook observes — the sensor must recognise its own output
(an identity check, like the `<task-notification>` case) or memory will
feed on memory; (d) a Core clause that says when memory may speak is the
first value the steward has to write.

**Not implemented; requires Kormie.**

## 2. Where a prompt came from: an `origin` field on packets

**What:** "what did I ask Claude to do in Mneme last week" is the
question the operator most wants answered and the one the store cannot
answer: a `user-prompt` packet carries no repository, directory, or
session. The `Stop` payload already carries `cwd`, and today the
adapter folds it into the session-stop packet's `text`; the
`UserPromptSubmit` payload carries `cwd` and `session_id` too, and the
adapter drops them.

**Gate:** ADAPTER.md fixes "one wire schema, five fields, no other
packet shape". A sixth field is a schema decision. Smuggling `cwd` into
`text` would keep the schema and break the other rule — text is the
observed prompt verbatim, never parsed — so that is not an option.

**Minimal diff:** `origin?: { cwd: string; session: string }` on the
Observation packet, optional, set by the Claude Code adapter from the
hook payload only. `sensor-normalize` copies it onto the SensedObs; the
semantic stand-in emits `(note, origin-cwd, …)` and `(note,
origin-session, …)` triples the way it emits `channel` and `kind`;
`--ask` and `--journal` gain a `--in <path-prefix>` filter and the
journal line shows the repository basename. Provenance, never content:
these triples join `channel`/`kind` in the metadata set the lexical
match ignores.

**Failure modes:** absolute paths are a privacy expansion — the store
would hold every directory the operator works in, and a note's `cwd`
can name a client or a project by itself; the steward decides whether
the store keeps the full path, a basename, or a hash, and whether the
`human-utterance-only` value should refuse packets whose origin is
missing. Like `kind`, origin is adapter-attested until the 0.11 sealed
provenance sidecar exists.

**Not implemented; requires Kormie.**

## 3. A git commit-message channel

**What:** commit messages are things the operator wrote, at a known
time, about work they did — ideal journal lines. A `post-commit` hook
would push a packet per commit: `channel: "git"`, `kind: "commit"`,
`text` = the commit message (subject and body), `t` = the commit time.

**Gate:** `CHANNELS` in `src/observation.ts` is a closed set for this
slice, ADAPTER.md names further adapters as out of scope, and brief §11
refuses the repo-indexer shape outright. The fence that keeps this on
the right side of §11: the human's words only — commit messages,
never diffs, file lists, or trees — and only for repositories the
operator names.

**Minimal diff:** one new channel value, one new `kind`, one
dependency-free hook script alongside `adapters/claude-code/hook.mjs`
with the same properties (exit 0 always, spool when no listener, no
stdout), and a `human-utterance-only` decision: is a commit message a
human utterance? It usually is, and sometimes a tool wrote it.

**Not implemented; requires Kormie.**

## 4. Buffer rotation after a clean drain

**What:** `~/.mneme/buffer.jsonl` only grows, and every dogfood run
re-drains all of it (idempotently, one permit per write; the digest now
counts the unchanged ones on one line). A `--rotate-buffer` flag on
`--dogfood` would rename the buffer to `buffer.<ISO of the newest
packet>.jsonl` after a drain, leaving a fresh empty buffer.

**Gate:** not an AGENTS.md gate. ADAPTER.md already says the operator
rotates the buffer on their own terms; this makes the tray do it on
request. Written here rather than built because it decides the fate of
packets the drain did not commit: a Core-denied packet or a skipped
line lives only in the buffer, and rotating moves it out of the next
drain's sight.

**Minimal diff:** opt-in, dogfood only; rename, never delete; refuse
when the run quarantined, denied, or skipped anything, or any check
failed, and say why; derive the archive name from packet times, never
the clock, so the printed output stays reproducible. The archive stays
drainable with `--buffer`.

**Not implemented; requires Kormie.**

## 5. Title clipping: a store-content decision, recorded

**What landed:** a heading-less packet's first line is now stored
clipped at 120 characters on a word boundary (`TITLE_MAX` in
`src/sensory.ts`); headings and heading-derived titles stay whole.
Before, a one-line Claude Code prompt persisted verbatim as its own
title, which contradicted DOGFOOD.md's "tokens, never prose".

**Why it is here:** it is not steward-gated (a non-frozen transform
stand-in, strictly less retention, one constant to revert), but it
changes what memory holds, and the "Creepy?" prompt is the steward's
channel for exactly that. Options: keep 120; shorten (80 reads like a
subject line; 60 loses most prompts' verbs); lengthen; or clip nothing
and correct the docs instead. Entries re-title themselves on their next
re-drain, since ids are the memory keys, so any choice is a one-line
change with no migration.

**Decision pending Kormie; 120 stands until then.**

## 6. Multi-note synthesis

**What was asked:** roadmap item 10 named "multi-note synthesis". What
a deterministic stand-in can offer is a keyword intersection across
hits ("words these notes share") and the by-day journal. The journal
shipped. The intersection did not: three independent reviewers agreed
it reads as insight without being any, and DOGFOOD.md commits to
returning source notes and stored facts without fabricating a
narrative.

**Where it belongs:** real synthesis is a model-backed `rerank` or
`semantic` node, which is 0.11 work behind the sealed provenance
channel, and a Core clause about what a synthesis may say. Nothing to
build in this slice.

**Not implemented; needs the 0.11 pack.**
