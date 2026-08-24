# Desk-tray dogfood

A small, local-only flavour of MNEME you can run on your own desk notes.
You drop markdown files into an inbox directory; the Helix scheduler runs
the declared kernel graphs over them (sensory → working → long-term, with
a secrets quarantine at the gate, one Core permit per commit, and a
prompt-corpus audit at the end), remembers them in one local JSON file,
and writes a `mneme.trace/v1` you can read line by line. `--ask` runs the
declared read path over that memory, so last week's notes answer this
week's questions. The behaviour is deterministic: the same inbox and the
same starting memory produce byte-identical output.

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

The run prints a per-note digest (and anything quarantined), commits to
the local store, and writes `helix/traces/tray.json`. Open the trace and
read it: every event names a node or edge that exists in
`spec/kernel.json`, every long-term `store.write` sits immediately after
its own `core.permit`, and the one `audit.inbox` write is permit-exempt
by law. The checks printed are untrusted TypeScript mirrors of the Lean
predicates in `spec/lean/Trace.lean`; the Lean build remains the
artifact of record (ADR-008).

## Daily use

The loop a developer actually keeps: drop notes as they happen, ingest
at the end of the day, ask questions later.

```sh
# during the day: standups, PR review notes, CI post-mortems,
# "follow up with X", git log summaries — one markdown file each
$EDITOR ~/mneme-tray/$(date +%F)-standup.md

# end of day: ingest (idempotent — rerun any time)
npx tsx src/tray.ts --inbox ~/mneme-tray

# later, from memory:
npx tsx src/tray.ts --ask "what did I write about Jordan?"
npx tsx src/tray.ts --ask "CI flake"
```

Ask mode runs the declared pg-w2l read path (`query → hybrid → rerank →
inject`) over your store — deterministic lexical retrieval across note
names, titles, headings, and extracted triples; no model, no network,
and its trace (`helix/traces/ask.json`) contains no `store.write` and
needs no permit. A note is remembered by its filename, title (the first
heading, or the first line when a note has none), headings, and a capped
bag of its body keywords — accent-folded, so "reunion" finds "réunion".
The store holds those tokens, never the prose itself. `--store` points
both modes at a different memory file if you want separate trays.

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

Next, in rank order:

4. **Better retrieval.** Body keywords are indexed now; still open:
   multi-note synthesis, phrase queries, and a date-aware "what happened
   last week" — all deterministic, all within the declared graph.
5. **Steward-gated proposals only.** Richer structural edges live in the
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
