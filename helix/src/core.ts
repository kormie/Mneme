/**
 * The steward-owned Core file: the operator's constitution as data the
 * tray loads, never writes. The default lives at ~/.mneme/core.json
 * (`--core` relocates it); the operator edits it by hand, and it is an
 * input to determinism — same inbox, same store, same core.json, same
 * bytes out. A missing file is an empty Core (no constitution yet).
 * Anything else that fails — unreadable, bad JSON, wrong shape — throws
 * before any drain: a constitution is never silently disabled.
 *
 * `values` is a closed enum of steward-named predicates the stand-in
 * ValueFilter implements (src/tray.ts); the loader checks shape only,
 * so an unrecognized value still loads and then fails closed at the
 * filter. `prose` is the steward's own words about those values: it is
 * never interpreted, and it never enters the IdentitySnapshot.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CoreFile {
  values: string[];
  goals: string[];
  prose: string;
}

/** The IdentitySnapshot shape every graph ingress takes: values and
 * goals only. `prose` stays behind by construction. */
export interface IdentitySnapshot {
  values: string[];
  goals: string[];
  style: Record<string, never>;
}

const CORE_KEYS = ["values", "goals", "prose"] as const;

export function emptyCore(): CoreFile {
  return { values: [], goals: [], prose: "" };
}

export function defaultCoreFile(): string {
  return join(homedir(), ".mneme", "core.json");
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Load the steward-owned Core file. ENOENT is the one soft failure
 * (empty Core); every other problem throws. The shape check is strict —
 * all three keys present, no others — because a misspelled key that
 * loaded as "no values" would silently disable the constitution, which
 * is exactly the failure this loader exists to refuse.
 */
export function loadCore(file: string): CoreFile {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyCore();
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `core file ${file} is not JSON (${err instanceof Error ? err.message : String(err)}); fix it or remove it — a broken constitution never loads as empty`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`core file ${file}: expected { "values": [], "goals": [], "prose": "" }`);
  }
  const o = parsed as Record<string, unknown>;
  const unknown = Object.keys(o).filter(
    (k) => !(CORE_KEYS as readonly string[]).includes(k),
  );
  if (unknown.length > 0) {
    throw new Error(`core file ${file}: unrecognized key(s) ${unknown.join(", ")}`);
  }
  if (!isStringArray(o.values)) {
    throw new Error(`core file ${file}: "values" must be an array of strings`);
  }
  if (!isStringArray(o.goals)) {
    throw new Error(`core file ${file}: "goals" must be an array of strings`);
  }
  if (typeof o.prose !== "string") {
    throw new Error(`core file ${file}: "prose" must be a string`);
  }
  return { values: o.values, goals: o.goals, prose: o.prose };
}

/** Project the Core into the IdentitySnapshot graphs consume. `prose`
 * is deliberately not here and must never be. */
export function coreSnapshot(core: CoreFile): IdentitySnapshot {
  return { values: [...core.values], goals: [...core.goals], style: {} };
}
