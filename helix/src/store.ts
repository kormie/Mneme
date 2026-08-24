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

export function emptyStore(): TrayStore {
  return { store: "mneme.tray-store/v1", episodic: {}, semantic: {} };
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
  return parsed;
}

export function saveStore(file: string, store: TrayStore): void {
  mkdirSync(dirname(file), { recursive: true });
  const sorted: TrayStore = {
    store: store.store,
    episodic: Object.fromEntries(
      Object.keys(store.episodic).sort().map((k) => [k, store.episodic[k]!]),
    ),
    semantic: Object.fromEntries(
      Object.keys(store.semantic).sort().map((k) => [k, store.semantic[k]!]),
    ),
  };
  writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
}
