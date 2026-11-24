/**
 * Differential testing, running half. Builds the seeded corpus from
 * differential-gen.ts, evaluates it with three implementations of the same
 * decidable predicates, and compares:
 *
 *   Lean   the pack's own `…B` defs, via `lake env lean` (certificate of record)
 *   Bend   bend/, via `bend` (a second checker)
 *   TS     the untrusted mirrors in laws.ts and trace.ts (the judge)
 *
 * Lean is the reference. Any case where Bend or TS disagrees with Lean is a
 * divergence and fails the run. Agreement on a finite corpus is evidence, not
 * a proof, and certifies nothing (ADR-008).
 *
 *   bun src/differential.ts [--seed N] [--kernels N] [--traces N] [--bend-dir DIR] [--keep]
 *
 * Needs `lake`/`lean` (run `./scripts/sync-lean.sh && cd proofs && lake build`
 * first) and `bend` (`./scripts/install-bend.sh`) on PATH.
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadKernel } from "./kernel.js";
import {
  COLUMNS,
  bendBatches,
  DEFAULT_SEED,
  TRACE_COLUMNS,
  buildCorpus,
  renderBend,
  renderLean,
  tsKernelRow,
  tsTraceRow,
  type Corpus,
} from "./differential-gen.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const BEND_MODULES = ["Kernel", "Util", "Trace", "WellFormed", "Decidable"];

export interface Row {
  id: string;
  bits: string[];
}

export function parseRows(text: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    rows.set(parts[0]!, parts.slice(1));
  }
  return rows;
}

function need(cmd: string, args: string[], hint: string): void {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error(`${cmd} is not usable: ${hint}`);
}

function runLean(file: string): string {
  const r = spawnSync("lake", ["env", "lean", file], {
    cwd: resolve(ROOT, "proofs"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`lean failed (exit ${r.status}):\n${(r.stdout + r.stderr).slice(0, 4000)}`);
  }
  return r.stdout;
}

function runBend(dir: string, file: string): string {
  const r = spawnSync("bend", [file], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BEND_NO_TELEMETRY: "1" },
  });
  if (r.status !== 0) {
    throw new Error(`bend failed (exit ${r.status}):\n${(r.stdout + r.stderr).slice(0, 4000)}`);
  }
  // `main` returns a String; bend prints it as a quoted, escaped literal.
  const out = r.stdout.trim();
  const last = out.split("\n").filter((l) => l.startsWith('"')).pop();
  if (last === undefined) throw new Error(`bend printed no string result:\n${out.slice(0, 2000)}`);
  return JSON.parse(last) as string;
}

export interface Divergence {
  id: string;
  column: string;
  lean: string;
  other: string;
  against: "bend" | "ts";
  how: string[];
}

export function compare(
  corpus: Corpus,
  lean: Map<string, string[]>,
  bend: Map<string, string[]>,
  ts: Map<string, string[]>,
): { divergences: Divergence[]; cases: number; comparisons: number } {
  const divergences: Divergence[] = [];
  let comparisons = 0;
  const check = (id: string, cols: string[], how: string[]): void => {
    const l = lean.get(id);
    if (!l) throw new Error(`Lean produced no row for ${id}`);
    for (const [against, rows] of [["bend", bend], ["ts", ts]] as const) {
      const o = rows.get(id);
      if (!o) throw new Error(`${against} produced no row for ${id}`);
      if (o.length !== l.length) throw new Error(`${against} row for ${id} has ${o.length} columns, Lean has ${l.length}`);
      cols.forEach((col, i) => {
        comparisons++;
        if (l[i] !== o[i]) divergences.push({ id, column: col, lean: l[i]!, other: o[i]!, against, how });
      });
    }
  };
  for (const k of corpus.kernels) check(k.id, COLUMNS, k.how);
  for (const t of corpus.traces) check(t.id, TRACE_COLUMNS, [JSON.stringify(t.events.map((e) => e.type))]);
  return { divergences, cases: corpus.kernels.length + corpus.traces.length, comparisons };
}

export interface Options {
  seed: number;
  kernels: number;
  traces: number;
  keep: boolean;
  /** Where the Bend modules come from. Defaults to bend/; tests point it at a mutated copy. */
  bendDir: string;
}

export function runDifferential(opts: Options): number {
  need("lake", ["--version"], "install elan, then run ./scripts/sync-lean.sh && (cd proofs && lake build)");
  need("bend", ["version"], "run ./scripts/install-bend.sh");

  const baseIR = loadKernel();
  const { corpus, base } = buildCorpus(baseIR, opts);

  const dir = mkdtempSync(join(tmpdir(), "mneme-diff-"));
  try {
    for (const m of BEND_MODULES) copyFileSync(resolve(opts.bendDir, `${m}.bend`), join(dir, `${m}.bend`));
    const leanFile = join(dir, "Diff.lean");
    writeFileSync(leanFile, renderLean(corpus, base));
    const bend = new Map<string, string[]>();
    bendBatches(corpus).forEach((batch, i) => {
      const file = `Diff${i}.bend`;
      writeFileSync(join(dir, file), renderBend(batch, base));
      for (const [id, bits] of parseRows(runBend(dir, file))) bend.set(id, bits);
    });

    const lean = parseRows(runLean(leanFile));
    const ts = new Map<string, string[]>();
    for (const k of corpus.kernels) ts.set(k.id, tsKernelRow(k.kernel));
    for (const t of corpus.traces) ts.set(t.id, tsTraceRow(t.events, baseIR));

    const { divergences, cases, comparisons } = compare(corpus, lean, bend, ts);
    console.log(
      `differential: seed ${opts.seed}, ${corpus.kernels.length} kernels x ${COLUMNS.length} predicates, ` +
        `${corpus.traces.length} traces x ${TRACE_COLUMNS.length} predicates`,
    );
    console.log(`  ${cases} cases, ${comparisons} comparisons of Lean against each of bend and ts`);
    if (divergences.length === 0) {
      console.log("  Lean, Bend and the TypeScript mirrors agree on every case.");
      console.log("  Agreement on a finite corpus is evidence, not a certificate (ADR-008).");
      return 0;
    }
    console.log(`  DIVERGENCES: ${divergences.length}`);
    for (const d of divergences.slice(0, 40)) {
      console.log(`  - ${d.id} ${d.column}: Lean=${d.lean} ${d.against}=${d.other}  (${d.how.join("; ")})`);
    }
    if (divergences.length > 40) console.log(`  ... and ${divergences.length - 40} more`);
    if (opts.keep) console.log(`  inputs kept in ${dir}`);
    return 1;
  } finally {
    if (!opts.keep) rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]): Options {
  const o: Options = { seed: DEFAULT_SEED, kernels: 100, traces: 250, keep: false, bendDir: resolve(ROOT, "bend") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--keep") o.keep = true;
    else if (a === "--bend-dir") o.bendDir = resolve(argv[++i] ?? "");
    else if (a === "--seed" || a === "--kernels" || a === "--traces") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) throw new Error(`${a} needs a non-negative integer`);
      o[a.slice(2) as "seed" | "kernels" | "traces"] = v;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = runDifferential(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(`differential: ${(e as Error).message}`);
    process.exitCode = 2;
  }
}
