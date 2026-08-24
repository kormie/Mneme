/**
 * Resolve the L0 Observation buffer path. Both listener and dogfood use
 * this helper so they cannot silently choose different backlogs.
 */
import { join } from "node:path";

export function defaultBufferFile(base: string): string {
  return join(base, "buffer.jsonl");
}
