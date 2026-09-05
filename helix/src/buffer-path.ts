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

/** The hook honours MNEME_SPOOL and MNEME_SOCK (ADAPTER.md); every
 * process that sweeps or inspects the spool must resolve it the same
 * way, or a relocated spool is silently never swept. */
export function resolveSpoolDir(base: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.MNEME_SPOOL ?? defaultSpoolDir(base);
}

export function resolveSockPath(base: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.MNEME_SOCK ?? join(base, "helix.sock");
}
