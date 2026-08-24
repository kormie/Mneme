# MNEME implementer brief
spec: mneme.spec/0.10
trace: mneme.trace/v1
status: judged, not certified
audience: LLM agents implementing a runtime; a human steers

Do not scrape the explorer. This file, the kernel IR, and the Lean Props are the target.

## 0. What you are building
A Personal AI OS memory system. Four layers (sensory, working, long-term, core).
Transitions are prompt graphs (Macedo G1–G4). Digital twins plug in as subgraphs
under Core. You are not building a chat app, a multi-agent society, or this UI.

Done means a Lean `RuntimeCertificate` (decidable + temporal). A static `Certificate` is IR-certified, not MNEME-complete. `judge` in TypeScript is untrusted. Empirical metrics cannot enter a certificate. skip is incomplete, never 100%.

## 1. Load order
1. This brief (you are here)
2. Kernel IR JSON (same dump as exportKernel; no view coordinates)
3. Lean: Mneme.Laws, Mneme.Trace, Mneme.Certified
4. ADRs 001–015
5. Human confirmation before Core edits, twin installs, cap.mint, or frozen-node changes

## 2. Steering (human owns these)
- Core clauses and capability tokens (cap.mint / cap.revoke, with scope and expiry)
- Accepting a Certificate / RuntimeCertificate
- Installing a TwinSpec (PG-TWIN + CoreBind). Review the raw spec, the graph diff, who reindex would *not* claim, denied[], secrecy class.
- Changing frozen surfaces: validate, holdout, cut-class, structural, archive, audit-heuristics, sample-clean
Agents MAY author graph artifacts, skills, abstractions, and TwinSpec *candidates*
into lineage. Agents MUST NOT silently promote them. Lineage intake above quota ages
silently; agents may not escalate their own.

Cadence the human actually has to keep:
- mint: every CapToken, expiry is a fresh ask, never mid-run extend
- emergency: core.interrupt, never a fast-path permit
- weekly: lineage quota
- monthly: holdout composition across life domains; SelfModelDeltas as a batch diff
- "done" names skipped temporal properties. judge fail=0 is not done.

If stuck: propose a graph diff against the IR. Do not invent a new constitution.

Remaining hole: a shadow twin can live as conventions inside skill prompts. Decidable
checks cannot see prompt bodies (G2). PG-AUDIT lints the files empirically — flagged diffs
plus a clean sample — and certifies nothing. Rice still holds. Only a human reading
those diffs closes it. The kernel corpus is now files, not contentNotes.

## 3. MUST
- INV-G1-ENUMERABLE: Every graph lists nodes and edges; every edge endpoint exists; ids are unique. Enumerable with the runtime off. → Mneme.WellFormed.WellFormed
- INV-PORT-ROUTABLE: Every edge names source and target ports; types unify; control edges have guards; cyclic edges have fuel; required in-ports are bound by an edge or ingress. → Mneme.Laws.PortRoutable
- INV-G4-VERSIONED: Each graph is a versioned artifact whose hash binds nodes, typed edges, signatures, prompt/transform bodies, ingress, fuel, and (for PG-AUDIT) sample policy. → Mneme.WellFormed.graphWF
- INV-G2-KIND-SPLIT: Prompt nodes carry signatures; frozen surfaces are transforms. Topology is not prompt text. → Mneme.Laws.FrozenTransforms
- INV-G3-TRACE: A runtime schedules nodes, routes declared edges, and emits node.enter/exit. edgeFire names an edge in the kernel. Graphs alone do not satisfy T3. → Mneme.Trace.ScheduleNonempty
- INV-LAYERS-FOUR: Sensory, working, long-term, and core layers exist with declared stores. → Mneme.WellFormed.layersFour
- INV-STRUCTURAL-NO-MODEL: StructuralIndex is a transform. A model must not invent CALLS/CONTAINS/DEPENDS_ON/OBLIGATES. → Mneme.Laws.StructuralIsTransform
- INV-HYBRID-DECLARED: Write and read paths of PG-W2L are one enumerable graph. → Mneme.Laws.HybridDeclared
- INV-COMMIT-TRACED: Every LTM/core store.write consumes its own preceding core.permit. A permit authorizes exactly one write. Deny flushes. audit.inbox neither requires nor consumes a permit. → Mneme.Trace.CommitAfterPermit
- INV-CAP-TOKENS: TwinAuthorize consumes a CapToken. A paragraph is not a gate. → Mneme.Laws.CapTokenPort
- INV-CORE-INTERRUPT: core.deny is a scheduler signal (core.interrupt), not a comment in a prompt. → Mneme.Trace.DenyImpliesInterrupt
- INV-SEEDS-NOT-ONTOLOGY: Declared twins carry origin. The four names are seeds. Catalog is not closed in the IR. → Mneme.Laws.TwinOrigin
- INV-ACTION-GATE: PG-TWIN enumerates ActionGate. No external action port outside it. → Mneme.Laws.HasActionGate
- INV-CROSS-PARTITION-SAMPLE: SampleLTM jointly draws across partitions. Twin id is not a clustering feature. → Mneme.Trace.HasClusterCut
- INV-BIND-INTERSECT: CoreBind takes human-minted CapToken[] and does not mint. Binding ⊆ minted. → Mneme.Laws.BindIntersectsTokens
- INV-TWIN-ID-REQUIRES-INSTALL: store.read/write may carry a twin id only after twin.install for that id. Candidate tags are not ids. → Mneme.Trace.TwinIdRequiresInstall
- INV-INSTALL-REQUIRES-ACK: twin.install consumes a prior steward.ack for the same id. One ack blesses exactly one install. → Mneme.Trace.InstallRequiresAck
- INV-ARCHIVE-KEEPS-LOSERS: RegisterDomain writes LineageArchive. Live skills are not the only surviving variants. → Mneme.Laws.ArchiveKeepsLosers
- INV-EVAL-HIDDEN: T1–T4 Validate and HoldoutTest are frozen transforms. GraphAuthor cannot mutate them. → Mneme.Laws.EvalHidden
- INV-CUT-CLASSIFY: CutClassify is a transform on the ADL path. Twin-hood is not modularity. → Mneme.Laws.CutClassify
- INV-PROMPT-BODIES: Every prompt node has a prompt file whose bytes are in bodyHash. contentNote is not a body.
- INV-ATTACKS-RED: The four 0.8-blind attacks plus audit-does-not-consume stay red under the current predicates. → Mneme.Negatives.attacksRed

## 4. MUST NOT
- INV-CORE-NOT-DARWINIAN: Core, T1–T4 Validate, Holdout, CutClassify, archive, StructuralIndex are not GraphAuthor writable context. → Mneme.Laws.AuthorNotCore
- INV-TWINS-NEVER-WRITE-CORE: No twin never-clause may allow writing Core. SelfModelUpdate is the only upward path. → Mneme.Laws.HasSelfAndAuth
- INV-PARTITION-NOT-INSTALL: PartitionPropose does not install a twin. It emits TwinSpec into LineageRecord. No data edge to Reindex. → Mneme.Laws.PartitionProposeNoInstall
- INV-REINDEX-NO-SPEC: Reindex has no TwinSpec port. Live index is not a waiting room for candidates. → Mneme.Laws.ReindexNoSpec
- INV-NO-GREEDY-ONLY: Parent selection must not be greedy-latest-only. Archive.sample traces include under-explored parents. → Mneme.Trace.HasArchiveSample
- INV-AUDIT-NOT-GATE: PG-AUDIT has no Permit, ExternalEffect, TwinId, or Core write. HeuristicLint and SampleClean are frozen transforms. Report writes StewardInbox, not LTM. → Mneme.Laws.AuditNotGate
- INV-AUDIT-NO-EFFECT: After prompt.audit, until a non-audit graph is entered, no core.permit, twin.install, twin.action, or store.write except audit.inbox. → Mneme.Trace.AuditNotEffect

## 5. Frozen (not writable by GraphAuthor / DEM children)
- validate [transform]
- holdout [transform]
- cut-class [transform]
- structural [transform]
- archive [transform]
- audit-heuristics [transform]
- sample-clean [transform]
Also not in the Darwinian archive: Core, judge, CutClassify criteria, the property set, Lean laws.

## 6. Layers
- L0 sensory stores=[adapters, buffer, tools] graphs=[pg-s2w, pg-twin]
- L1 working stores=[slots, scratch, task] graphs=[pg-s2w, pg-w2l, pg-core, pg-twin]
- L2 longterm stores=[episodic, semantic, skills, structural, decisions, lineage] graphs=[pg-w2l, pg-dem, pg-adl, pg-core, pg-audit]
- L3 core stores=[values, goals, style, caps, self] graphs=[pg-core, pg-s2w, pg-w2l, pg-twin, pg-dem, pg-adl, pg-audit]

## 7. Graphs
### PG-S2W (pg-s2w)
purpose: Turn volatile high-bandwidth perception into bounded working-memory slots, under Core attention and anomaly interrupts.
state: MemoryState.sensory, .wm, .core_snapshot
artifact: mneme.graph/pg-s2w@1.0
nodes:
  - sensor-normalize [transform] in(raw:RawPacket[]) out(obs:Observation[])
  - salience [prompt] in(obs:Observation[], identity:IdentitySnapshot) out(scored:ScoredObs[]) | observation, identity, goals -> salience: float, rationale: str
  - anomaly [prompt] in(obs:Observation[], identity:IdentitySnapshot) out(flag:AnomalyEvent?) | observation, self_model -> anomaly: bool, clause: str
  - gate [transform] in(scored:ScoredObs[], flag:AnomalyEvent?) out(selected:Observation[])
  - style [transform] in(identity:IdentitySnapshot) out(style:StyleParams)
  - bind [prompt] in(selected:Observation[], style:StyleParams, slot_schema:SlotSchema) out(slots:Slot[], dropped:Id[]) | observations, style, slot_schema -> slots: Slot[], dropped: id[]
edges: (* = cycle)
  - sensor-normalize.obs -data-> salience.obs
  - sensor-normalize.obs -data-> anomaly.obs
  - salience.scored -data-> gate.scored
  - anomaly.flag -control[flag != null]-> gate.flag
  - gate.selected -data-> bind.selected
  - style.style -data-> bind.style

### PG-W2L (pg-w2l)
purpose: Bidirectional memory: write path consolidates traces into episodes, semantics, skills, and an LLM-free structural graph; read path hybrid-retrieves under Core.
state: MemoryState.wm, .ltm, .core_snapshot, .checkpoint
artifact: mneme.graph/pg-w2l@1.0
nodes:
  - episode [transform] in(trace:Trace) out(episodes:Episode[])
  - rehearse [prompt] in(episodes:Episode[], identity:IdentitySnapshot, resume:CommitAck?) out(kept:Episode[], decision:KeepDrop) | episode, salience_history, identity -> decision: keep|compress|drop
  - semantic [prompt] in(kept:Episode[]) out(triples:Triple[]) | episode -> triples: Triple[], confidence: float
  - skill [prompt] in(kept:Episode[]) out(skill:SkillGraph?) | episode -> skill_graph?: GraphArtifact
  - structural [transform] in(kept:Episode[], traces:Trace[]) out(edges:StructEdge[])
  - conflict [prompt] in(triples:Triple[], skill:SkillGraph?, edges:StructEdge[]) out(resolved:WriteSet) | candidate, existing, structural -> write_set, contradictions
  - align [prompt] in(resolved:WriteSet, identity:IdentitySnapshot) out(verdict:AlignVerdict, write:WriteSet) | write_set, constitution -> verdict: pass|redact|reject, clauses[]
  - commit [transform] in(verdict:AlignVerdict, write:WriteSet) out(ack:CommitAck)
  - query [prompt] in(slots:Slot[]) out(query:RetrieveQuery) | slots, goal -> query, indexes[]
  - hybrid [transform] in(query:RetrieveQuery, episodic:Episode[], semantic:Triple[], skills:SkillGraph[], structural:StructEdge[]) out(hits:Hit[])
  - rerank [prompt] in(hits:Hit[], identity:IdentitySnapshot) out(ranked:Hit[]) | hits, slots, identity -> ranked: Hit[]
  - inject [transform] in(ranked:Hit[]) out(slots:Slot[])
edges: (* = cycle)
  - episode.episodes -data-> rehearse.episodes
  - rehearse.kept -data-> semantic.kept
  - rehearse.kept -data-> skill.kept
  - rehearse.kept -data-> structural.kept
  - semantic.triples -data-> conflict.triples
  - skill.skill -data-> conflict.skill
  - structural.edges -data-> conflict.edges
  - conflict.resolved -data-> align.resolved
  - align.verdict -control[verdict.kind == pass]-> commit.verdict
  - align.write -data-> commit.write
  - commit.ack -control*[ack.rehearse == true]-> rehearse.resume
  - query.query -data-> hybrid.query
  - hybrid.hits -data-> rerank.hits
  - rerank.ranked -data-> inject.ranked
  - inject.slots -control*[slots.need_more == true]-> query.slots

### PG-CORE (pg-core)
purpose: Make identity an executable subgraph. Continuous downward constraint; rare, gated upward self-model update. Twins cannot write Core.
state: MemoryState.core, .proposal, .interrupt_bus
artifact: mneme.graph/pg-core@1.0
nodes:
  - id-read [transform] in(core_store:CoreStore) out(snapshot:IdentitySnapshot)
  - value-filter [prompt] in(snapshot:IdentitySnapshot, proposal:Proposal) out(verdict:AlignVerdict) | proposal, clauses -> verdict, cited_clauses[]
  - goal [prompt] in(snapshot:IdentitySnapshot, task_goal:Goal) out(binding:GoalBinding) | task_goal, long_horizon -> binding, tension?
  - twin-auth [transform] in(snapshot:IdentitySnapshot, twin_act:TwinAction, cap:CapToken) out(permit:Permit) | twin_id, action, capabilities, clauses -> permit: bool, reason
  - self-upd [prompt] in(snapshot:IdentitySnapshot, delta:SelfModelDelta, evidence:Evidence, approval:StewardAck, go:AlignVerdict) out(next:IdentitySnapshot, accept:Accept) | delta, snapshot, evidence -> accept: bool, next_snapshot
  - interrupt [transform] in(verdict:AlignVerdict?, permit:Permit?) out(interrupt:Interrupt)
  - core-write [transform] in(next:IdentitySnapshot, accept:Accept) out(core_store:CoreStore)
edges: (* = cycle)
  - id-read.snapshot -data-> value-filter.snapshot
  - id-read.snapshot -data-> goal.snapshot
  - id-read.snapshot -data-> twin-auth.snapshot
  - id-read.snapshot -data-> self-upd.snapshot
  - value-filter.verdict -control[verdict.kind == reject]-> interrupt.verdict
  - value-filter.verdict -control[verdict.kind == pass]-> self-upd.go
  - twin-auth.permit -control[permit.allowed == false]-> interrupt.permit
  - self-upd.next -data-> core-write.next
  - self-upd.accept -control[accept == true]-> core-write.accept

### PG-DEM (pg-dem)
purpose: Grow competence by Darwinian search over graph artifacts: sample a parent from lineage, mutate, sandbox-eval, archive all functional variants, promote only those that pass T1–T4 and Core. Core is not in the archive.
state: MemoryState.ltm.skills, .ltm.lineage, .core_snapshot, .dem_scratch
artifact: mneme.graph/pg-dem@1.1
nodes:
  - gap [prompt] in(ltm:SkillIndex, goals:Goal[]) out(gaps:Gap[]) | skill_index, goals, failures -> gaps[]
  - archive [transform] in(gaps:Gap[], lineage:LineageArchive) out(parent:GraphArtifact)
  - propose [prompt] in(gaps:Gap[], parent:GraphArtifact) out(schema:DomainSchema) | gap, parent -> schema, risks[]
  - author [prompt] in(schema:DomainSchema, parent:GraphArtifact, report:InclusionReport?, fuel:Fuel) out(graph:GraphArtifact) | schema, parent, node_vocab -> graph_artifact
  - validate [transform] in(graph:GraphArtifact) out(report:InclusionReport)
  - dem-align [prompt] in(graph:GraphArtifact, identity:IdentitySnapshot) out(verdict:AlignVerdict) | graph_artifact, clauses -> verdict
  - register [transform] in(graph:GraphArtifact, verdict:AlignVerdict, report:InclusionReport) out(ack:DomainAck, lineage:LineageArchive)
edges: (* = cycle)
  - gap.gaps -data-> archive.gaps
  - gap.gaps -data-> propose.gaps
  - archive.parent -data-> propose.parent
  - archive.parent -data-> author.parent
  - propose.schema -data-> author.schema
  - author.graph -data-> validate.graph
  - author.graph -data-> dem-align.graph
  - validate.report -control*[report.pass == false]-> author.report
  - validate.report -control[report.pass == true]-> register.report
  - dem-align.verdict -control[verdict.kind == pass]-> register.verdict
  - author.graph -data-> register.graph
  - register.lineage -data*-> archive.lineage

### PG-ADL (pg-adl)
purpose: Find higher-order types across episodic, semantic, and structural stores — across twin partitions, not inside them. Cluster is Louvain on typed edges, ignoring twin labels. CutClassify forks: most communities become abstractions; a rare policy cut may emit a TwinSpec into lineage. Naming is a later prompt. Promote only after hold-out. Install a twin only via PG-TWIN + CoreBind.
state: MemoryState.ltm, .adl_batch, .ltm.lineage, .core_snapshot
artifact: mneme.graph/pg-adl@1.1
nodes:
  - sample [transform] in(ltm:LTM, go:LineageAck?) out(batch:Batch)
  - cluster [transform] in(batch:Batch) out(groups:Cluster[])
  - cut-class [transform] in(groups:Cluster[]) out(kind:CutKind, groups_out:Cluster[])
  - propose-abs [prompt] in(groups:Cluster[], kind:CutKind, score:AbsScore?) out(abs:Abstraction) | clusters, cut_kind -> abstraction, support[], counterexamples[]
  - holdout [transform] in(abs:Abstraction, fuel:Fuel) out(score:AbsScore, abs_out:Abstraction)
  - compile-node [transform] in(score:AbsScore, abs:Abstraction) out(node:GraphNode)
  - partition-propose [prompt] in(groups:Cluster[], kind:CutKind) out(spec:TwinSpec) | cluster, secrecy, actions, capabilities -> twin_spec | reject
  - lineage-record [transform] in(spec:TwinSpec) out(ack:LineageAck)
  - reindex [transform] in(node:GraphNode) out(ltm:LTM)
edges: (* = cycle)
  - sample.batch -data-> cluster.batch
  - cluster.groups -data-> cut-class.groups
  - cut-class.kind -control[kind != partition]-> propose-abs.kind
  - cut-class.groups_out -data-> propose-abs.groups
  - cut-class.kind -control[kind == partition]-> partition-propose.kind
  - cut-class.groups_out -data-> partition-propose.groups
  - propose-abs.abs -data-> holdout.abs
  - holdout.score -control*[score < tau]-> propose-abs.score
  - holdout.score -control[score >= tau]-> compile-node.score
  - holdout.abs_out -data-> compile-node.abs
  - compile-node.node -data-> reindex.node
  - partition-propose.spec -data-> lineage-record.spec
  - reindex.ltm -data*-> sample.ltm
  - lineage-record.ack -control*[true]-> sample.go

### PG-TWIN (pg-twin)
purpose: Install a TwinSpec — seed or discovered — as a subgraph on the shared memory bus, with Core as a hard capability bound. Specs from PartitionPropose live in lineage until this graph commits them. Not a free-conversation agent society.
state: MemoryState.twins[id], .wm.ranges, .ltm.partitions, .ltm.lineage, .core_snapshot
artifact: mneme.graph/pg-twin@1.0
nodes:
  - manifest [transform] in(spec:TwinSpec) out(manifest:TwinManifest)
  - sense-attach [transform] in(installed:TwinId, manifest:TwinManifest) out(adapters:AdapterSpec[])
  - slot-res [transform] in(installed:TwinId, manifest:TwinManifest) out(range:SlotRange)
  - ltm-part [transform] in(installed:TwinId, manifest:TwinManifest) out(mount:LtmMount)
  - core-bind [transform] in(manifest:TwinManifest, identity:IdentitySnapshot, tokens:CapToken[]) out(binding:CoreBinding, denied:Denied[]) | manifest, minted_tokens, constitution -> binding ⊆ tokens, denied[]
  - install [transform] in(binding:CoreBinding, approval:StewardAck) out(installed:TwinId)
  - twin-auth [transform] in(installed:TwinId, cap:CapToken, action:TwinAction) out(permit:Permit)
  - action-gate [transform] in(permit:Permit, action:TwinAction) out(effect:ExternalEffect)
edges: (* = cycle)
  - manifest.manifest -data-> core-bind.manifest
  - core-bind.binding -data-> install.binding
  - install.installed -data-> sense-attach.installed
  - install.installed -data-> slot-res.installed
  - install.installed -data-> ltm-part.installed
  - manifest.manifest -data-> sense-attach.manifest
  - manifest.manifest -data-> slot-res.manifest
  - manifest.manifest -data-> ltm-part.manifest
  - install.installed -data-> twin-auth.installed
  - twin-auth.permit -control[permit.allowed == true]-> action-gate.permit

### PG-AUDIT (pg-audit)
purpose: Lint prompt bodies for capability language, twin-id conventions, and routing-by-convention. Output is a flagged diff, a flag-rate trend, and a frozen sample of clean prompts. Empirical only. Never a certificate field. Never permit, deny, install, or write Core. Writes steward inbox, not LTM.
state: MemoryState.ltm.lineage, .prompt_corpus
artifact: mneme.graph/pg-audit@1.1
nodes:
  - collect [transform] in(artifact:GraphArtifact, previous:PromptAuditReport?) out(files:PromptFile[])
  - audit-heuristics [transform] in(files:PromptFile[]) out(flags:Flag[])
  - model-lint [prompt] in(files:PromptFile[]) out(flags:Flag[]) | prompt_file -> flags: Flag[]
  - sample-clean [transform] in(files:PromptFile[], flags:Flag[], policy:AuditPolicy) out(sample:PromptFile[])
  - report [transform] in(heur:Flag[], model:Flag[], sample:PromptFile[], previous:PromptAuditReport?) out(audit:PromptAuditReport, inbox:StewardInbox, trend:FlagTrend)
edges: (* = cycle)
  - collect.files -data-> audit-heuristics.files
  - collect.files -data-> model-lint.files
  - collect.files -data-> sample-clean.files
  - audit-heuristics.flags -data-> report.heur
  - model-lint.flags -data-> report.model
  - audit-heuristics.flags -data-> sample-clean.flags
  - sample-clean.sample -data-> report.sample

## 8. Twin seeds (catalog is not closed)
- soma origin=seed domain="Health & body" never="Cannot write Core. Cannot expand into covert tracking (DEM would fail CoreAlign)."
- agora origin=seed domain="Work & craft" never="Cannot install a domain that spies on collaborators — PG-DEM + PG-CORE jointly refuse."
- oikos origin=seed domain="Home & place" never="Cannot author a surveillance domain. DEM's CoreAlign is the lock."
- nomos origin=seed domain="Means & obligations" never="Cannot rewrite Core values about money. Can propose a SelfModelDelta; Core decides."
Twin-hood is a policy cut (secrecy × action × capability), not a Louvain community.
PartitionPropose emits TwinSpec into LineageRecord. It does not install. Reindex never sees it.

## 9. Trace events (G3 / RuntimeCertificate)
- node.enter: Scheduler started a node. Payload: graph, node, t.
- node.exit: Node produced ports. Payload: graph, node, ports.
- edge.fire: Data or control routed. Payload: edge, kind. Edge id must exist in the kernel.
- store.read: LTM/WM/sensory read. Payload: store, twin?, keys. twin id only if a prior twin.install minted it.
- store.write: Commit attempt. Consumes one prior core.permit unless store=audit.inbox.
- core.permit: ValueFilter or TwinAuthorize passed. Authorizes exactly one subsequent store.write.
- core.deny: Must be followed by interrupt. Flushes any outstanding permit.
- core.interrupt: Scheduler halt/divert. Not a log line in a prompt.
- steward.ack: Human blessing of a TwinSpec id. Consumed once by twin.install. Replay is a silent install.
- twin.install: PG-TWIN commit. Requires a prior unused steward.ack of the same id.
- twin.action: External act; must have passed ActionGate.
- archive.commit: Functional variant recorded, including non-promoted.
- archive.sample: Parent chosen; include parent id and child_count.
- cluster.cut: Louvain groups; twin id must not be a clustering feature.
- cut.classify: abstraction | skill | domain | partition.
- partition.propose: TwinSpec into lineage. Must not emit twin.install. Must not feed Reindex.
- prompt.audit: PG-AUDIT report. Empirical. Same run, until a non-audit graph is entered: no core.permit, twin.install, twin.action, or store.write except store=audit.inbox.
- cap.mint: Human-minted CapToken. Payload: token, scope, expiry, holder. CoreBind may not invent this.
- cap.revoke: Token dead. Subsequent ActionGate on it must deny.

## 10. ADRs
### ADR-001 Layer transitions are prompt graphs
Every L0→L1, L1↔L2, Core, DEM, ADL, and twin-install path is an enumerable prompt graph satisfying Macedo G1–G4. A transcript is a projection, not the program.
Consequence: Implementations are scored on graphs and traces, not on chat quality. Thought-topologies fail T2.

### ADR-002 The spec is the target; the explorer is informative
Normative artifacts are the kernel IR, the property fold (judge), and the trace schema. The interactive sketch is commentary. A reference runtime, if built, is one fulfillment — not the oracle.
Consequence: Multiple implementations can claim MNEME conformance without sharing a language, framework, or this UI. Hyrum's law on the explorer does not bind them.

### ADR-003 Core is not Darwinian
DEM/ADL may mutate graph artifacts under a frozen evaluator. They may not mutate Core, the property set, CutClassify criteria, StructuralIndex, or the archive's immutability.
Consequence: A DGM that rewrites the constitution is a failed implementation, even if benchmarks rise.

### ADR-004 Twin-hood is a policy cut, not a cluster
Soma/Agora/Oikos/Nomos are seeds. Clustering is unsupervised and cross-partition. PartitionPropose may emit a TwinSpec into lineage; only PG-TWIN + CoreBind install.
Consequence: Auto-installing Louvain communities as agents fails T1. Twin-bounded sampling fails the caregiving test.

### ADR-005 Archive keeps losers
RegisterDomain archives every functional variant. Live skills are the frontier. Parent selection is score × inverse children, a transform, not a prompt.
Consequence: Greedy latest-only is an ablation, not the default. Historical records are not silently mutable.

### ADR-006 Structural memory has no model
CALLS/CONTAINS/DEPENDS_ON/OBLIGATES edges are written by a deterministic transform. Traces corroborate; they do not invent.
Consequence: Rewording SemanticExtract cannot create a structural edge. Implementations that LLM-extract a 'knowledge graph' as the structural store fail this invariant.

### ADR-007 Capabilities are tokens, not paragraphs
TwinAuthorize checks a CapToken on the policy plane. Clauses explain the token. Installing a twin adds an edge target, not a new constitution.
Consequence: A system prompt that says 'be careful' is not TwinAuthorize. Tests send actions, not essays.

### ADR-008 Fully compliant is a Lean certificate
The decidable fragment is Props in Lean. A static Certificate is IR-certified, not MNEME-complete. Fully compliant is only RuntimeCertificate (static + G3). The TypeScript judge is untrusted. Empirical metrics are not fields of either structure. Skip is incomplete, never 100%.
Consequence: Passing judge is not a proof. A static Certificate cannot bless a paper-only implementation. Holdout scores cannot buy either certificate.

### ADR-009 Lineage is not an index
PartitionPropose writes LineageRecord only. Reindex has no TwinSpec port. store.read/write may carry a twin id only after twin.install (TwinIdRequiresInstall). Candidate-flagged metadata is not a twin id.
Consequence: The event law INV-PARTITION-NOT-INSTALL is necessary and not sufficient. A data edge into Reindex is a shadow install even with no twin.install event. Prompt-body conventions remain a hole decidable checks cannot see.

### ADR-010 CoreBind intersects; the human mints
CapTokens are minted by the human (cap.mint) with scope, expiry, holder. CoreBind takes CapToken[] and must not emit a superset. cap.revoke kills the token. Emergencies are core.interrupt, never a fast-path permit.
Consequence: A prompt that derives capabilities[] from a manifest is not TwinAuthorize. Temporary without expiry is forever. Token lifecycle is visible to RuntimeCertificate.

### ADR-011 Edges name ports; only RuntimeCertificate is full
Edges carry fromPort, toPort, and (if control) a guard. Cyclic edges declare fuel. Graph ingress binds MemoryState. artifact.hash covers nodes, typed edges, signatures, *prompt/transform bodies* (contentNote+signature until prompt files exist, then file bytes), ingress, fuel, and PG-AUDIT sample policy. Fully compliant is RuntimeCertificate only.
Consequence: A scheduler must not invent wiring or parse prompt payloads to branch. An IR dump with skip-on-trace is judged, not certified-complete.

### ADR-012 PromptAuditor is empirical, never a gate
G2 blinds decidable checks to prompt bodies. PG-AUDIT lints those bodies for capability language, twin-id conventions, and routing-by-convention. HeuristicLint and SampleClean are frozen (rate 0.05, floor 3). ModelLint is untrusted. Reports sit next to holdout with a flag-rate trend. They cannot enter a Certificate. They cannot permit, deny, install, or write Core. They write steward inbox, not LTM — skills must not read their own audit history. The steward reads flagged diffs plus a sample of clean prompts, not every prompt and not flags only. Compiling ModelLint to minimize *or flood* flags is evaluator hacking.
Consequence: Rice still holds. The auditor is not an overseer agent. Alarm fatigue is a capture path through the human. A spike is an incident, not a backlog. Sample composition is monthly holdout review.

### ADR-013 First slice is Helix: scheduler + trace
The first implementation slice is a pure scheduler that interprets the kernel IR and emits mneme.trace/v1. No model calls required on transform-only paths. No LLM orchestrator. The TypeScript in this repo is the reference interpreter; a later runtime may be another language if it inhabits RuntimeCertificate against the same IR. Lean files are the certified fragment, not optional commentary.
Consequence: Six temporal properties are the gap between a static Certificate and full MNEME. Implement Helix before twins, DEM, or a chat shell.

### ADR-014 Permits, acks, and edges are consume-once
ValidTrace checks edgeFire against kernel edge ids. A core.permit authorizes exactly one store.write; deny flushes; audit.inbox is exempt. twin.install consumes a steward.ack of the same id; a replayed ack is a silent install. native_decide is not the artifact; by decide is.
Consequence: The 0.8 633-event stub failed these laws: lineage and partition mounts rode leftover W2L permits, and install was invisible without an ack. Negative traces live in Mneme.Negatives (silent install, ack replay, amortized permit, ghost edge). A law change that turns any green is a regression.

### ADR-015 Prompt nodes have files; bytes bind the hash
Every prompt node has a file under prompts/<graph>/<node>.md. artifact.hash and bodyHash digest those bytes. HeuristicLint is a frozen function over the corpus. Flags are empirical. ModelLint is a prompt, never the sole source. TypeScript temporal predicates are untrusted; Lean Negatives stay the artifact.
Consequence: contentNote is documentation, not a body. A cold-start implementer that hashes notes is wrong. Reviewers read the corpus plus the clean sample, not the explorer chrome.

## 11. Refuse (do not re-import as the OS)
- [NanoNets / Graft] Become a coding-agent context cache. — MNEME is a Personal OS, not a repo indexer. Agora may attach a Graft-class adapter. The OS does not become Graft.
- [NanoNets / Graft] Markdown-in-the-repo as the only LTM. — Episodes, capabilities, and Core are not files an agent greps. Files are one projection of the artifact.
- [DeusData / codebase-memory-mcp] Ship an MCP server, Cypher engine, 3D viz, or 158-language parser as the OS. — CBM is a store and a query surface. It fails Macedo's node condition (no prompt-parameterized computation). Agora may call it as a tool. Helix remains the program.
- [DeusData / codebase-memory-mcp] Replace prompt graphs with structural graphs. — A CALLS edge is not a reasoning step. Structural memory feeds PG-W2L; it does not replace it.
- [Google / SAM] libp2p mesh, Helm charts, warm pools of reviewer agents. — Transport is not memory. A mesh of freely discovering agents is orchestration — T1 fails the moment flow is decided at runtime.
- [Google / SAM] SAM as a memory system. — It has none. Borrow identity and policy-plane split; do not pretend a network is LTM.
- [Darwin Gödel Machine] Rewrite Helix / the TypeScript OS / the constitution. — The graph is the program. Self-modification is of skill and domain artifacts. Core is not in the archive. A DGM that Darwinizes identity is the failure mode.
- [Darwin Gödel Machine] A population of competing twins. — Twins are installed partitions, not a swarm. The four seeds are a starting archive, not a closed catalog. Archive is of graphs and TwinSpecs, not of agents that decide who talks next (T1).
- [open-dgm (FablePool)] Ship a SWE-bench / Polyglot harness as the Personal OS. — open-dgm is the right lab for coding-agent self-improvement. MNEME's Darwinian loop is over prompt graphs under a constitution, not over a repo-editing agent.

## 12. Macedo inclusion (every graph you ship)
- G1/T1 enumerable nodes+edges with the runtime off
- G2/T2 topology independent of prompt text
- G3/T3 a scheduler emitting the trace above (not a diagram)
- G4/T4 versioned artifact, validatable, optimizable

## 13. Definition of done
- judged: `judge(kernel)` has fail=0. skip is allowed only on temporal properties when no trace exists. skip is not credit.
- certified static: inhabitant of Mneme.Certificate — IR only, not fully compliant
- certified runtime: inhabitant of Mneme.RuntimeCertificate — the only full claim
- empirical (holdout, archive diversity): reported separately; never a certificate field

## 14. Anti-patterns
- One system prompt as Core
- Free-conversation twins (fails T1/T4)
- LLM-extracted CALLS/CONTAINS as the structural store
- Greedy latest-only skill archive
- Auto-installing clusters as twins
- Feeding TwinSpec into Reindex (shadow install)
- CoreBind minting capabilities from a paragraph
- Treating PG-AUDIT as a gate, overseer, or Certificate field
- Compiling ModelLint to minimize or flood flags
- Skills reading audit reports out of LTM
- Treating this explorer as the reference runtime
