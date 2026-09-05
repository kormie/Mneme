/**
 * The tray's local memory: one JSON file the operator can open, copy, or
 * delete. Keys are note ids, so re-ingesting a note replaces its entry
 * (idempotent by construction). This is tray-level persistence for the
 * dogfood — the trace remains the artifact the laws speak about.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export interface Episode {
  id: string;
  note: string;
  title: string;
  headings: string[];
  /** Adapter channel that observed it ("file" for dropped notes). Absent
   * in stores written before live channels existed; read as "file". */
  channel?: string;
  /** An exact prefix of the clean source, capped at 1200 UTF-16 units. */
  excerpt?: string;
  /** Observation time in milliseconds since the Unix epoch. */
  observedAt?: number;
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
  // Observation ids are data, including names such as "__proto__".
  // Null prototypes keep assigning those ids from mutating a dictionary.
  return {
    store: "mneme.tray-store/v1",
    episodic: Object.create(null) as Record<string, Episode>,
    semantic: Object.create(null) as Record<string, Triple[]>,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Validate before accepting memory, and before replacing it on disk. */
function checkedStore(value: unknown, file: string): TrayStore {
  const invalid = (part: string): never => {
    throw new Error(`unrecognized tray store format in ${file}: ${part}`);
  };
  if (!isRecord(value) || value.store !== "mneme.tray-store/v1" ||
      !isRecord(value.episodic) || !isRecord(value.semantic)) {
    return invalid("expected episodic and semantic dictionaries");
  }

  const store = emptyStore();
  for (const key of Object.keys(value.episodic).sort()) {
    const ep = value.episodic[key];
    if (!isRecord(ep) || typeof ep.id !== "string" || ep.id !== key ||
        typeof ep.note !== "string" || ep.note.length === 0 || ep.id !== `ep:${ep.note}` ||
        typeof ep.title !== "string" || !Array.isArray(ep.headings) ||
        ![...ep.headings].every((h: unknown) => typeof h === "string") ||
        (Object.hasOwn(ep, "channel") && (typeof ep.channel !== "string" || ep.channel.length === 0)) ||
        (Object.hasOwn(ep, "excerpt") && (typeof ep.excerpt !== "string" || ep.excerpt.length > 1200)) ||
        (Object.hasOwn(ep, "observedAt") &&
          (typeof ep.observedAt !== "number" || !Number.isFinite(ep.observedAt) ||
            Math.abs(ep.observedAt) > 8.64e15))) {
      return invalid(`invalid episode ${key}`);
    }
    // Spread creates own data properties, even for prototype-shaped keys.
    store.episodic[key] = { ...ep, headings: [...ep.headings] } as unknown as Episode;
  }
  for (const key of Object.keys(value.semantic).sort()) {
    const triples = value.semantic[key];
    if (key.length === 0 || !Array.isArray(triples) || ![...triples].every((triple: unknown) =>
      isRecord(triple) && triple.s === key &&
      typeof triple.p === "string" && triple.p.length > 0 && typeof triple.o === "string",
    )) {
      return invalid(`invalid triples for ${key}`);
    }
    store.semantic[key] = triples.map((triple) => ({ ...triple })) as Triple[];
  }
  return store;
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
  return checkedStore(JSON.parse(raw) as unknown, file);
}

export function saveStore(file: string, store: TrayStore): void {
  const sorted = checkedStore(store, file);
  // Finish validation and serialization before touching the destination.
  const text = JSON.stringify(sorted, null, 2) + "\n";
  mkdirSync(dirname(file), { recursive: true });
  const temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  let created = false;
  try {
    // Same-directory rename is atomic; exclusive create cannot overwrite
    // another writer's temporary file. Personal memory is owner-readable.
    fd = openSync(temp, "wx", 0o600);
    created = true;
    writeFileSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, file);
    created = false;
  } finally {
    // Cleanup must not replace the original write error with a secondary
    // close/unlink error. The previously committed destination stays intact.
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* retain the original failure */ }
    }
    if (created) {
      try { unlinkSync(temp); } catch { /* retain the original failure */ }
    }
  }
}
