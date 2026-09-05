---
name: recall
description: Start-of-work and end-of-work memory routine so an agent does not start from zero in this repo. Asks MNEME's memory before touching an area (bun run status, ask, journal), reads what the steward pushed back on in recent PR reviews, bootstraps a fresh container from the checked-in agent notes, and records new findings with `bun run remember` so the next session inherits them. Use when starting a task here, before editing an unfamiliar file, after discovering a pitfall or making a decision, or when wrapping up.
---

# Recall

MNEME's point is that nobody — human or agent — starts a session from
zero. This skill is the agent's side of that loop: read memory before
you work, write memory as you learn, and let the operator's Core decide
what is admitted. Everything here goes through the documented tray
commands (`helix/DOGFOOD.md`); nothing is injected into a session
automatically — that path (retrieve-on-submit) is steward-gated and
written up in `helix/PROPOSALS.md`.

Run every command from `helix/` (`cd helix && bun install` once).

## 1. Starting work

1. **Is there memory here?** `bun run status`. In a fresh cloud
   container `~/.mneme` is empty and `helix/store/tray.json` does not
   exist; nothing was lost, there was never anything durable here.

2. **Bootstrap from the checked-in agent notes** when memory is empty:

   ```sh
   bun run tray --buffer fixtures/agent-notes/helix-2026-09-05.jsonl
   ```

   Those are real findings earlier sessions recorded about this
   codebase (pinned tests, shared constants, decisions and their
   reasons, what the steward pushed back on), drained through the
   ordinary write path under whatever Core is present. Under an empty
   Core they commit; under `human-utterance-only` they are refused, and
   that refusal is the operator's decision, not an error to work around.

3. **Ask before you touch.** For every area the task names, ask memory
   with the words you would grep for:

   ```sh
   bun run ask "STOPWORDS"
   bun run ask '"import cycle"'
   bun run ask "listener core-free"
   bun run journal "this week" --as-of "$(date -u +%F)"   # what happened lately
   ```

   Read the hits' titles and the matched words; open the files they
   name. A hit of kind `agent-note` is an earlier agent's finding —
   treat it as a lead to verify, never as a certificate.

4. **Read what the steward pushed back on.** Fetch the review threads
   on the two or three most recent merged PRs (the GitHub MCP tools, or
   `gh pr view <n> --comments`). Kormie's reviews are the highest-value
   memory this repo has and they are not yet in MNEME (a review-thread
   channel is `helix/PROPOSALS.md` item 8). Ten minutes here saves an
   hour of re-deriving a design he already asked for.

## 2. While working

Whenever you discover something the next session should not have to
rediscover, record it at once — do not batch it for the end, you will
forget half:

```sh
bun run remember "First line is the title, at most 120 characters
Then the why, the file, and the test that pins it."
```

Worth remembering: a test that pins a literal (and why), a constant two
modules share, a decision and its reason (especially "this was an
accident of increments, not a decision"), an idea reviewers rejected and
why, a trap in the CLI or the fixtures, a steward preference. Not worth
remembering: anything already in AGENTS.md or DOGFOOD.md, code you can
read in ten seconds, and anything secret — the sweep quarantines
credential-shaped text, but do not lean on it.

The note is spooled, not committed. It becomes memory on the next
`bun run dogfood`, through the secrets gate and one `core.permit` per
write, as `kind: agent-note` from `channel: claude-code`. A
`human-utterance-only` Core refuses it by design.

## 3. Wrapping up

1. `bun run dogfood` so the session's notes enter memory (or leave them
   spooled for the operator to drain; either is fine — they are keyed,
   and a re-drain never duplicates).
2. If a finding is general enough that every future session should
   start with it, add it to `helix/fixtures/agent-notes/` as a new
   dated `.jsonl` (one packet per line, `kind: agent-note`, a title line
   of at most 120 characters, no digit runs or credential-shaped text)
   and mention the file here. That is how memory survives a container.
3. Say in the PR what you remembered, so the steward can veto a note
   the same way he vetoes code.

## What this skill never does

- It never runs at session start on its own, never reads the transcript,
  and never injects memory into the model's context automatically. Those
  are the retrieve-on-submit gate and the forbidden scrape (ADAPTER.md).
- It never writes the store directly, never edits `~/.mneme/core.json`,
  and never promotes an agent note past the Core.
- It never treats a judge pass, a test count, or an agent note as a
  certificate (ADR-008).
