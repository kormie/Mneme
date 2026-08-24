# Desk-tray dogfood

A small, local-only flavour of MNEME you can run on your own desk notes.
You drop markdown files into an inbox directory; the Helix scheduler runs
the declared kernel graphs over them (sensory → working → long-term, with
one Core permit per commit, and a prompt-corpus audit at the end) and
writes a `mneme.trace/v1` file you can read line by line. The behaviour is
deterministic: the same inbox produces a byte-identical trace.

This is a laptop tool for the operator's own notes. It is not a KOHO
product feature and touches no KOHO system.

## What it is, and is not

- **Local-only. No network.** The CLI reads files in the inbox directory
  and the spec pack in this repository, and writes one trace file. It
  makes no network calls, no model calls, and sends nothing anywhere.
  Prompt nodes run deterministic offline stand-ins.
- **The inbox is files the human dropped.** Nothing is watched, scraped,
  or synced. If you did not put a file in the inbox directory yourself,
  the tray never sees it.
- **The Core store is empty.** No agent authored constitution clauses on
  your behalf. An empty constitution constrains nothing, so every commit
  passes ValueFilter — each one still consumes its own `core.permit`, and
  the stand-in refuses to run at all against steward-authored clauses it
  cannot honestly interpret.
- **A commit-attempt trace, not a database.** The only thing a run
  persists is the trace file. The long-term stores and the steward inbox
  exist as events in that trace, not as files or mailboxes you can open
  afterwards. The printed checks are slice-local, untrusted TypeScript:
  the full temporal law set (`Mneme.Trace.Temporal`) also requires ADL
  and DEM activity (`cluster.cut`, `archive.sample`) that this tray
  deliberately never produces, and no concrete tray trace has been
  imported into Lean yet. That import is the roadmap's endgame, not a
  thing this tool already claims.

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

You need Node 22+ and a clone of this repository. Nothing else.

```sh
cd helix
npm ci
mkdir -p ~/mneme-tray            # your inbox, anywhere you like
cp fixtures/tray/*.md ~/mneme-tray   # or drop your own notes in
npx tsx src/tray.ts --inbox ~/mneme-tray
```

Running it with no arguments uses the checked-in fixtures:

```sh
npx tsx src/tray.ts              # equivalent: npm run tray
```

The run prints a per-note digest and the trace checks, and writes
`helix/traces/tray.json`. Open the trace and read it: every event names a
node or edge that exists in `spec/kernel.json`, every long-term
`store.write` sits immediately after its own `core.permit`, and the one
`audit.inbox` write is permit-exempt by law. The checks printed are
untrusted TypeScript mirrors of the Lean predicates in
`spec/lean/Trace.lean`; the Lean build remains the artifact of record
(ADR-008).

## Roadmap and known debt

Ranked next slices, all inside the current law (KOHO's stack — git,
GitHub CI, TypeScript, Go, Python, Terraform, Claude Code — is fertile
inbox material, but MNEME must stay the operator's own memory, never a
repo indexer; brief §11 refuses the Graft shape outright):

1. **Anomaly gate for secrets.** `pg-s2w` already declares the `anomaly`
   node and the `e4` control edge; a deterministic applier that flags
   credential and card-number patterns would exercise the deny path for
   real and make every later slice safer. CI logs and Terraform plans are
   exactly where secrets leak, so this comes first.
2. **More note flavours.** `git log` day summaries, saved PR reviews, CI
   failure post-mortems, Claude Code session summaries — dropped as
   markdown, nothing watched or scraped.
3. **The read path.** `query → hybrid → rerank → inject` is declared and
   scheduler-tested; wiring it into the CLI turns a week of committed
   episodes into answers.
4. **Steward-gated proposals only.** Richer structural edges live in the
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
   it to keep?
3. **Missing Core clause?** The constitution is empty, so every commit
   passed. What is the first clause you wished had been there to stop or
   reshape a write? Phrase it in your own words; the steward, not an
   agent, decides what enters Core.
