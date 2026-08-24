# CLAUDE.md

@AGENTS.md

The governance contract — the law, layout, commands, current-slice
roadmap, and known spec issues — lives in [AGENTS.md](AGENTS.md) and
applies to Claude Code exactly as written there. This file adds only
what is genuinely specific to running as Claude Code in this repo.

## Claude Code

- `.claude/settings.json` mechanically enforces `Edit`/`Write`-deny on
  `spec/**` and `spec.sha256`, and `.claude/hooks/guard-spec-writes.sh`
  (a PreToolUse hook) additionally denies Bash-shaped writes to those
  same paths and denies force-push. As AGENTS.md's steward-gates
  section notes, these are the only governance rules in this repo with
  an automated backstop, and only in this tool surface; everything else
  on that list is enforced by review, not by a permission system.
- `.claude/hooks/`, `.claude/agents/`, and `.claude/skills/` hold this
  repo's Claude-Code-specific automation (hooks, subagents, and skills,
  respectively). Check those directories for what is currently
  configured; they are maintained independently of this file.
