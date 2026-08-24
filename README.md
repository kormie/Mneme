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

Agents work here under [CLAUDE.md](CLAUDE.md). Humans should read it too;
it is the shortest accurate description of the rules of this repo.

## Quickstart

```sh
./scripts/verify-spec.sh              # pack integrity
cd helix && npm ci && npm test        # Helix (Node 22+)
./scripts/sync-lean.sh
cd proofs && lake build               # laws + regression suite (Lean 4.33.1 via elan)
```

## Dogfood

There is a local-only desk-tray CLI you can point at a folder of your own
markdown notes; it runs the kernel graphs over them and emits a
`mneme.trace/v1` you can read. Setup, scope fences, and the three feedback
prompts live in [helix/DOGFOOD.md](helix/DOGFOOD.md).

## Map

| Path | What |
| --- | --- |
| `spec/` | The 0.10 pack: brief, kernel IR, Lean laws, prompt corpus. Read-only. |
| `proofs/` | Lake project checking the laws + `Regressions.lean` (attacks stay red, axiom-guarded). |
| `helix/` | ADR-013 reference interpreter workspace. |
| `scripts/` | Spec verification and Lean source sync. |
| `CLAUDE.md` | The autonomy contract: steward gates, slice scope, definition of done. |
