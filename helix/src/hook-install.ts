#!/usr/bin/env bun
/**
 * `bun run install-hook [--write]`: put the Claude Code hook into
 * ~/.claude/settings.json without hand-editing, so a fleet install (or a
 * person who would rather not paste JSON) gets the exact block
 * ADAPTER.md documents, and nothing else changes in that file.
 *
 * Dry run by default: prints the merged settings and stops. `--write`
 * is the one explicit act that edits the operator's Claude settings —
 * an agent never passes it on its own; a person or an MDM run does. The
 * merge is idempotent (an entry whose command is already present is not
 * added twice), preserves every other key and every other hook, refuses
 * a file it cannot read as a JSON object, and keeps a `.bak` of what it
 * replaced. It never touches ~/.mneme, the store, or the Core.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELIX_ROOT = resolve(HERE, "..");

export const HOOK_EVENTS = ["UserPromptSubmit", "Stop"] as const;

/** The command settings.json runs: the hook path quoted, so a clone under
 * a directory with a space still runs. */
export function hookCommand(helixRoot: string = HELIX_ROOT): string {
  return `node ${JSON.stringify(join(helixRoot, "adapters", "claude-code", "hook.mjs"))}`;
}

interface HookEntry {
  hooks: { type: string; command: string }[];
  [key: string]: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Merge the two hook entries into a settings object. Returns the new
 * settings (the input is not mutated) and which events gained an entry.
 * Throws on a shape it must not guess at: settings not an object,
 * `hooks` not an object, an event's value not an array.
 */
export function mergeHookSettings(
  existing: unknown,
  command: string,
): { settings: Record<string, unknown>; added: string[] } {
  if (!isObject(existing)) throw new Error("settings must be a JSON object");
  const hooksIn = existing.hooks ?? {};
  if (!isObject(hooksIn)) throw new Error('settings "hooks" must be an object');
  const hooks: Record<string, unknown> = { ...hooksIn };
  const added: string[] = [];
  for (const event of HOOK_EVENTS) {
    const entries = hooks[event] ?? [];
    if (!Array.isArray(entries)) throw new Error(`settings "hooks.${event}" must be an array`);
    const present = entries.some((entry) =>
      isObject(entry) && Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => isObject(h) && h.command === command)
    );
    if (present) continue;
    const entry: HookEntry = { hooks: [{ type: "command", command }] };
    hooks[event] = [...entries, entry];
    added.push(event);
  }
  return { settings: { ...existing, hooks }, added };
}

export function defaultSettingsFile(): string {
  return join(homedir(), ".claude", "settings.json");
}

function readSettings(file: string): unknown {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} is not JSON (${err instanceof Error ? err.message : String(err)}); fix it by hand first`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  let write = false;
  let settingsFile = defaultSettingsFile();
  let helixRoot = HELIX_ROOT;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--write") write = true;
    else if (a === "--settings" || a === "--helix-root") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${a}`);
      if (a === "--settings") settingsFile = resolve(value);
      else helixRoot = resolve(value);
    } else throw new Error(`unknown argument: ${a}`);
  }
  const command = hookCommand(helixRoot);
  const { settings, added } = mergeHookSettings(readSettings(settingsFile), command);
  const text = JSON.stringify(settings, null, 2) + "\n";
  if (!write) {
    console.log(text.trimEnd());
    console.log(
      added.length === 0
        ? `# already installed in ${settingsFile}; nothing to write`
        : `# dry run: would add ${added.join(" and ")} to ${settingsFile}; pass --write to apply`,
    );
    return;
  }
  if (added.length === 0) {
    console.log(`already installed: ${settingsFile} runs ${command} on ${HOOK_EVENTS.join(" and ")}`);
    return;
  }
  mkdirSync(dirname(settingsFile), { recursive: true });
  if (existsSync(settingsFile)) renameSync(settingsFile, `${settingsFile}.bak`);
  writeFileSync(settingsFile, text);
  console.log(`installed: added ${added.join(" and ")} to ${settingsFile}` +
    (existsSync(`${settingsFile}.bak`) ? ` (previous file kept as ${settingsFile}.bak)` : ""));
  console.log("next: work in Claude Code, then `bun run status` to see packets arrive");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    console.error(`install-hook: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
