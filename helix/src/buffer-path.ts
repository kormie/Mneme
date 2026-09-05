/**
 * Resolve the L0 sensory paths under one base directory (~/.mneme by
 * default): the Observation buffer the listener appends to, and the spool
 * the hook falls back to when no listener is up. Listener and dogfood
 * both use these helpers so they cannot silently choose different
 * backlogs.
 */
import { join } from "node:path";

export function defaultBufferFile(base: string): string {
  return join(base, "buffer.jsonl");
}

export function defaultSpoolDir(base: string): string {
  return join(base, "spool");
}
