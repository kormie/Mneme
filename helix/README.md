# Helix

The ADR-013 slice: a pure scheduler over `../spec/kernel.json`, emitting
`mneme.trace/v1`. Scope fence and roadmap live in the root `CLAUDE.md`.
The kernel IR is normative; types in `src/kernel.ts` mirror it, never
extend it. `judge` (roadmap step 2) is untrusted by design (ADR-008).

`src/tray.ts` is the desk-tray dogfood CLI — a local-only run of the
scheduler over your own markdown notes. See [DOGFOOD.md](DOGFOOD.md).
