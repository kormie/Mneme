# Helix

The ADR-013 slice: a pure scheduler over `../spec/kernel.json`, emitting
`mneme.trace/v1`. Scope fence and roadmap live in the root `AGENTS.md`.
The kernel IR is normative; types in `src/kernel.ts` mirror it, never
extend it. `judge` (roadmap step 2) is untrusted by design (ADR-008).

`src/tray.ts` is the desk-tray dogfood CLI — a local-only run of the
scheduler over your own markdown notes and buffered Claude Code
prompts: `--dogfood` drains, `--ask` and `--journal` read, `--status`
inspects, `--hook-snippet` prints the hook install block. See
[DOGFOOD.md](DOGFOOD.md); the steward-gated asks the daily loop still
wants are in [PROPOSALS.md](PROPOSALS.md).

`src/listen.ts` is the sensory adapter loop: adapters (Claude Code hooks
in `adapters/claude-code/`) push Observation packets over a unix socket
or a spool directory, and the listener feeds them to pg-s2w's declared
ingress. See [ADAPTER.md](ADAPTER.md).
