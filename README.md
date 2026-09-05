# Mneme

A Personal AI OS memory system. Four layers (sensory, working, long-term,
core), layer transitions as enumerable prompt graphs, digital twins as
installed partitions under a Core the human owns. Compliance is not vibes:
the decidable and temporal laws live in Lean, and "fully compliant" means
inhabiting `Mneme.RuntimeCertificate` with a real trace.

The canonical spec pack is `spec/` (**mneme.spec/0.10**, read-only,
checksummed). The current implementation slice is **Helix** (ADR-013): a
pure TypeScript scheduler that interprets `spec/kernel.json` and emits
`mneme.trace/v1`. No twins, DEM, or chat shell in this slice.

> **Guardrails:** `spec/` is read-only canon — never edited, reformatted,
> or "fixed" by any agent or human. Read [AGENTS.md](AGENTS.md)'s
> steward gates before changing anything under `spec/`, Core semantics,
> capability tokens, twin installs, or any frozen surface.

Agents work here under [AGENTS.md](AGENTS.md), the governance contract
for every agent regardless of vendor (Claude Code, Codex, Cursor, Gemini
CLI, Copilot's coding agent, or a tool-less browser chat agent — the
last should be pointed at [CONTEXT.md](CONTEXT.md) instead, a
self-contained, non-normative briefing for pasting into a chat window).
Claude Code additionally reads the short stub [CLAUDE.md](CLAUDE.md).
Humans should read AGENTS.md too; it is the shortest accurate
description of the rules of this repo.

## Quickstart

```sh
./scripts/verify-spec.sh              # pack integrity
cd helix && bun install && bun test   # Helix (Bun 1.3+)
./scripts/sync-lean.sh
cd proofs && lake build               # laws + regression suite (Lean 4.33.1 via elan)
```

## Dogfood

There is a local-only desk-tray CLI you can point at a folder of your own
markdown notes; it runs the kernel graphs over them and emits a
`mneme.trace/v1` you can read. Setup, scope fences, and the three feedback
prompts live in [helix/DOGFOOD.md](helix/DOGFOOD.md).

### Daily use, in five minutes

Everything below is local: no network, no model, and nothing becomes
memory except by a command you run.

```sh
cd helix && bun install

# once: let Claude Code's hook observe your prompts. Prints the block
# for ~/.claude/settings.json with this clone's path; paste it in.
bun run hook-snippet

# work in Claude Code as usual; the hook spools each prompt. Drop any
# markdown notes you write into ~/mneme-tray. Then, whenever you like:
bun run status                                   # is anything waiting?
bun run dogfood                                  # sweep, drain, judge

# read memory the way you would a journal (the clock stays in your
# shell; the run itself is reproducible):
bun run journal "yesterday" --as-of "$(date -u +%F)" --utc-offset -04:00
bun run journal "this week" --as-of "$(date -u +%F)"
bun run ask "canary rollout"                     # newest first
bun run ask '"code review" last week' --as-of "$(date -u +%F)"
```

`dogfood` sweeps the hook's spool through the sensory graph into the
buffer, drains buffer and inbox together through the write path (one
`core.permit` per `store.write`), writes one trace, and judges it. No
daemon is needed. What memory keeps is names, titles, headings, and a
capped keyword bag per note — plus, for a heading-less prompt, its
first line clipped at 120 characters — and your Core file
(`~/.mneme/core.json`) decides what may be written at all. The things
the loop still wants and this slice must not build alone are written
up for the steward in [helix/PROPOSALS.md](helix/PROPOSALS.md).

## Why the name

*Mneme* (Greek Μνήμη, *mnēmē*) means memory or remembrance. It is the root
of *mnemonic*, *amnesia*, and *Mnemosyne*. In the oldest Greek tradition,
recorded by Pausanias, Mneme was one of the three original Muses of Mount
Helicon alongside Melete (practice) and Aoide (song): the Muse of memory,
the faculty that let a poet carry an epic before there was writing to keep
it in.

That is the whole pitch of this repo. MNEME is a memory system before it is
anything else: four layers, transitions between them, and a Core the human
owns. A few more things line up:

- **Retained, not merely stored.** *Mnēmē* names what stays with you, closer
  to a lasting impression than to a filing cabinet. The layered model, with
  transitions that promote and age material between layers, reads the same
  way.
- **The Muse, not the Titan.** Mnemosyne is the cosmic mother of the nine
  Muses; Mneme is the smaller, human-scale figure. That fits a *personal*
  memory system rather than a universal one.
- **Trace as memory.** In 1904 the biologist Richard Semon borrowed *Mneme*
  for his theory of memory traces, coining *engram* in the same book. The
  definition of done here is a real emitted `mneme.trace/v1` inhabiting
  `Mneme.RuntimeCertificate`, so the trace-as-memory lineage is baked into
  the word's modern history too.

It is also short, and commonly anglicized as "NEE-mee".

## Map

| Path | What |
| --- | --- |
| `spec/` | The 0.10 pack: brief, kernel IR, Lean laws, prompt corpus. Read-only. |
| `proofs/` | Lake project checking the laws + `Regressions.lean` (attacks stay red, axiom-guarded). |
| `helix/` | ADR-013 reference interpreter workspace. |
| `scripts/` | Spec verification, Lean source sync, and toolchain bootstrap (`bootstrap.sh` — pastes into a cloud agent's setup script field). |
| `AGENTS.md` | The autonomy contract for all agents: steward gates, slice scope, definition of done. |
| `CLAUDE.md` | Short Claude-Code-specific stub; defers to `AGENTS.md`. |
| `CONTEXT.md` | Self-contained, non-normative briefing for tool-less browser chat agents. |
