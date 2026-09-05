/**
 * Writing a mneme.trace/v1 file to disk. Split out of the tray so the
 * listener and the tray can both import it without importing each other
 * (the tray sweeps the listener's spool; the listener writes traces).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TraceFile } from "./trace.js";

export function writeTrace(trace: TraceFile, outFile: string): void {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(trace, null, 2) + "\n");
}
