/**
 * Select the default L0 Observation buffer during the ndjson → jsonl
 * filename migration. Both listener and dogfood use this helper so they
 * cannot silently choose different backlogs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseObservation } from "./observation.js";

function readBufferIfPresent(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function hasObservation(text: string | null): boolean {
  if (text === null) return false;
  return text.split("\n").some((line) =>
    line.trim() !== "" && parseObservation(line) !== null
  );
}

/**
 * Prefer the canonical jsonl file when it contains packets, otherwise a
 * legacy ndjson file that contains packets. File existence or malformed
 * non-packet content alone never diverts new writes away from jsonl.
 */
export function defaultBufferFile(base: string): string {
  const jsonl = join(base, "buffer.jsonl");
  const ndjson = join(base, "buffer.ndjson");
  const jsonlText = readBufferIfPresent(jsonl);
  if (hasObservation(jsonlText)) return jsonl;

  const ndjsonText = readBufferIfPresent(ndjson);
  if (hasObservation(ndjsonText)) return ndjson;
  return jsonl;
}
