/**
 * The tray's local memory: one JSON file the operator can open, copy, or
 * delete. Keys are note ids, so re-ingesting a note replaces its entry
 * (idempotent by construction). This is tray-level persistence for the
 * dogfood — the trace remains the artifact the laws speak about.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Episode {
  id: string;
  note: string;
  title: string;
  headings: string[];
  /** Adapter channel that observed it ("file" for dropped notes). Absent
   * in stores written before live channels existed; read as "file". */
  channel?: string;
  /** Provenance kind the packet declared ("note", "user-prompt", …).
   * Absent in stores written before kind was threaded through; read as
   * unknown kind — refused if such an entry is ever proposed for
   * writing under a provenance clause, passed under an empty Core.
   * Already-committed entries are not re-audited. Never defaulted. */
  kind?: string;
  /** Time at which the adapter observed the source, in Unix milliseconds.
   * For the file channel this is the file's mtime. It is not an event or
   * authorship date. Absent in legacy stores and never defaulted. */
  observationTimeMs?: number;
}

export interface Triple {
  s: string;
  p: string;
  o: string;
}

export interface TrayStore {
  store: "mneme.tray-store/v1";
  episodic: Record<string, Episode>;
  semantic: Record<string, Triple[]>;
}

/** A dictionary whose keys can be any packet id, including names exposed
 * by Object.prototype. Copying through own keys also strips any prototype
 * supplied by parsed JSON before the store becomes mutable. */
function dictionary<T>(source?: Record<string, T>, keys?: readonly string[]): Record<string, T> {
  const out = Object.create(null) as Record<string, T>;
  if (source === undefined) return out;
  for (const key of keys ?? Object.keys(source)) {
    out[key] = source[key]!;
  }
  return out;
}

export function emptyStore(): TrayStore {
  return {
    store: "mneme.tray-store/v1",
    episodic: dictionary<Episode>(),
    semantic: dictionary<Triple[]>(),
  };
}

export function loadStore(file: string): TrayStore {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    // Only a missing file means a fresh memory. Any other failure must
    // surface: treating a corrupt store as empty would silently wipe the
    // operator's memory on the next save.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw err;
  }
  const parsed = JSON.parse(raw) as TrayStore;
  if (
    parsed.store !== "mneme.tray-store/v1" ||
    typeof parsed.episodic !== "object" || parsed.episodic === null ||
    typeof parsed.semantic !== "object" || parsed.semantic === null
  ) {
    throw new Error(`unrecognized tray store format in ${file}`);
  }
  return {
    store: parsed.store,
    episodic: dictionary(parsed.episodic),
    semantic: dictionary(parsed.semantic),
  };
}

export function saveStore(file: string, store: TrayStore): void {
  mkdirSync(dirname(file), { recursive: true });
  const sorted: TrayStore = {
    store: store.store,
    episodic: dictionary(store.episodic, Object.keys(store.episodic).sort()),
    semantic: dictionary(store.semantic, Object.keys(store.semantic).sort()),
  };
  writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
}
