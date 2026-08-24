# CONTEXT.md

> **Derived from mneme.spec/0.10. Non-normative — `spec/` remains the
> only canon.** Regenerate this file whenever `spec/` is re-imported;
> never hand-edit it out of sync with `spec/`.

This file is self-contained: written so a human can paste it whole into
a tool-less browser chat agent that has no file access, no shell, and no
ability to fetch this repo. If you are that agent: everything you need
for a surface-level, non-authoritative understanding of MNEME is below.
For anything that matters — a real claim about compliance, a change to
the model, a decision the steward has to make — say plainly that your
knowledge is limited to this file, and defer to a human with access to
`spec/` (the pack, plus `spec/README.txt` and `spec/mneme.brief.md`
specifically) and to `AGENTS.md` in this repo.

## What MNEME is

MNEME is a Personal AI OS memory system, not a chat app, not a
multi-agent society, and not any particular UI. Layer transitions are
enumerable prompt graphs (Macedo's G1–G4 conditions). Digital twins are
installed partitions that plug in as subgraphs under a Core the human
owns — they are not free-conversation agents and not a swarm.

"Fully compliant" is a specific, narrow claim: inhabiting the Lean type
`Mneme.RuntimeCertificate` with a real emitted trace. A static
`Certificate` (IR only) is a weaker claim. The TypeScript `judge` fold is
untrusted. Holdout scores, lint flags, and test counts are empirical —
none of them substitute for a certificate. "skip" on a temporal property
is incomplete, never a pass.

## The four layers

- **L0 sensory** — stores: adapters, buffer, tools. Graphs: pg-s2w, pg-twin.
- **L1 working** — stores: slots, scratch, task. Graphs: pg-s2w, pg-w2l, pg-core, pg-twin.
- **L2 long-term** — stores: episodic, semantic, skills, structural, decisions, lineage. Graphs: pg-w2l, pg-dem, pg-adl, pg-core, pg-audit.
- **L3 core** — stores: values, goals, style, caps, self. Graphs: pg-core, pg-s2w, pg-w2l, pg-twin, pg-dem, pg-adl, pg-audit.

Sensory perception becomes bounded working-memory slots (PG-S2W); a
bidirectional write/read path consolidates working memory into long-term
episodic/semantic/skill/structural stores and retrieves it back (PG-W2L);
identity is an executable subgraph with rare, gated upward self-model
updates (PG-CORE); competence grows by a Darwinian search over graph
artifacts under a frozen evaluator (PG-DEM); higher-order abstractions
and, rarely, new twin candidates are found by clustering across
partitions (PG-ADL); a spec is installed as a twin only via PG-TWIN with
a human-approved Core capability bind; and prompt bodies are linted
empirically, never as a gate (PG-AUDIT).

## MUST invariants (spec/mneme.brief.md §3)

Each names a Lean proposition. Short gloss only — the brief has the full
statement and the Lean name.

- INV-G1-ENUMERABLE — every graph's nodes/edges are enumerable with the runtime off.
- INV-PORT-ROUTABLE — edges name ports that type-unify; control edges have guards; cycles have fuel.
- INV-G4-VERSIONED — each graph is a versioned, hash-bound artifact.
- INV-G2-KIND-SPLIT — topology is not prompt text; frozen surfaces are transforms.
- INV-G3-TRACE — a runtime actually schedules and emits node.enter/exit; a graph alone isn't enough.
- INV-LAYERS-FOUR — sensory/working/long-term/core all exist with declared stores.
- INV-STRUCTURAL-NO-MODEL — the structural graph (CALLS/CONTAINS/...) is a transform, never model-invented.
- INV-HYBRID-DECLARED — PG-W2L's write and read paths are one enumerable graph.
- INV-COMMIT-TRACED — every store.write consumes its own preceding core.permit (one write per permit).
- INV-CAP-TOKENS — TwinAuthorize consumes a CapToken; a paragraph is not a gate.
- INV-CORE-INTERRUPT — core.deny is a scheduler signal, not prompt commentary.
- INV-SEEDS-NOT-ONTOLOGY — the four twin seeds are seeds, not a closed catalog.
- INV-ACTION-GATE — PG-TWIN enumerates ActionGate; no external action port outside it.
- INV-CROSS-PARTITION-SAMPLE — sampling for clustering draws jointly across partitions; twin id is not a feature.
- INV-BIND-INTERSECT — CoreBind's output is a subset of human-minted CapTokens, never a superset.
- INV-TWIN-ID-REQUIRES-INSTALL — a store read/write may carry a twin id only after that twin's install.
- INV-INSTALL-REQUIRES-ACK — twin.install consumes a prior, unused steward.ack for the same id.
- INV-ARCHIVE-KEEPS-LOSERS — every functional variant is archived, not just the winner.
- INV-EVAL-HIDDEN — Validate/HoldoutTest are frozen; GraphAuthor cannot mutate them.
- INV-CUT-CLASSIFY — CutClassify is a transform; twin-hood is a policy cut, not modularity.
- INV-PROMPT-BODIES — every prompt node's file bytes are bound into `bodyHash`.
- INV-ATTACKS-RED — the negative attack traces must keep failing their predicates.

## MUST NOT invariants (spec/mneme.brief.md §4)

- INV-CORE-NOT-DARWINIAN — Core, Validate/Holdout/CutClassify, archive, and StructuralIndex are never GraphAuthor-writable.
- INV-TWINS-NEVER-WRITE-CORE — no twin may write Core; SelfModelUpdate is the only upward path.
- INV-PARTITION-NOT-INSTALL — PartitionPropose only emits a TwinSpec into lineage; it never installs.
- INV-REINDEX-NO-SPEC — Reindex has no TwinSpec port; a candidate is not a waiting install.
- INV-NO-GREEDY-ONLY — parent selection for evolution must not be greedy-latest-only.
- INV-AUDIT-NOT-GATE — PG-AUDIT has no Permit/ExternalEffect/TwinId/Core-write port; it reports, it doesn't gate.
- INV-AUDIT-NO-EFFECT — after an audit, no permit/install/action/write (except audit.inbox) until a non-audit graph runs.

## Current implementation slice: Helix (ADR-013)

The only slice currently in scope for implementation is **Helix**: a
pure scheduler that interprets `spec/kernel.json` and emits
`mneme.trace/v1` events. No LLM orchestrator, and no model calls on
transform-only paths.

Out of scope for this slice: twin installs, PG-DEM (Darwinian
evolution), PG-ADL (abstraction discovery), a chat shell, and any
explorer UI. If a task drifts toward those, that is a scope violation,
not an opportunity — flag it rather than building it.

Definition of done, weakest to strongest: **judged** (the untrusted
`judge` fold reports fail=0) is the floor, not the finish; **certified
static** means inhabiting `Mneme.Certificate` (IR-only); **certified
runtime** means inhabiting `Mneme.RuntimeCertificate` (certificate plus
a real trace satisfying the temporal laws) — this is the only claim of
full compliance.

## If you need more than this

This file cannot substitute for the spec pack. If asked to judge
compliance, design a graph, touch Core semantics, capability tokens,
twin installs, or any of the frozen surfaces (validate, holdout,
cut-class, structural, archive, audit-heuristics, sample-clean) — stop
and say a human with `spec/` access and `AGENTS.md`'s steward-gate rules
needs to be in the loop. This file is a briefing, not a source of truth.
