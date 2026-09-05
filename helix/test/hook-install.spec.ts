/**
 * `bun run install-hook`: merges the Claude Code hook into a settings
 * file idempotently, writes only under --write, keeps a backup, and
 * refuses shapes it must not guess at. Every run here points --settings
 * at a temp file; the real ~/.claude is never read or written.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "bun:test";
import { hookCommand, mergeHookSettings } from "../src/hook-install.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELIX_ROOT = resolve(HERE, "..");
const INSTALL = join(HELIX_ROOT, "src", "hook-install.ts");
const run = promisify(execFile);

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `hook-install-${name}-`));
}

describe("mergeHookSettings", () => {
  const cmd = hookCommand("/opt/My Projects/Mneme/helix");

  it("adds both events to empty settings, quoting the path", () => {
    const { settings, added } = mergeHookSettings({}, cmd);
    expect(added).toEqual(["UserPromptSubmit", "Stop"]);
    expect(cmd).toBe('node "/opt/My Projects/Mneme/helix/adapters/claude-code/hook.mjs"');
    for (const event of ["UserPromptSubmit", "Stop"]) {
      expect((settings.hooks as Record<string, unknown>)[event]).toEqual([
        { hooks: [{ type: "command", command: cmd }] },
      ]);
    }
  });

  it("preserves other keys and other hooks, and is idempotent", () => {
    const existing = {
      model: "opus",
      permissions: { allow: ["Bash(bun test:*)"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
        Stop: [{ hooks: [{ type: "command", command: "other-stop.sh" }] }],
      },
    };
    const first = mergeHookSettings(existing, cmd);
    expect(first.added).toEqual(["UserPromptSubmit", "Stop"]);
    expect(first.settings.model).toBe("opus");
    expect(first.settings.permissions).toEqual(existing.permissions);
    const hooks = first.settings.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toEqual(existing.hooks.PreToolUse);
    expect(hooks.Stop).toHaveLength(2); // the other Stop hook kept, ours appended
    expect(existing.hooks.Stop).toHaveLength(1); // input not mutated
    const second = mergeHookSettings(first.settings, cmd);
    expect(second.added).toEqual([]);
    expect(second.settings).toEqual(first.settings);
  });

  it("refuses shapes it must not guess at", () => {
    expect(() => mergeHookSettings([], cmd)).toThrow(/must be a JSON object/);
    expect(() => mergeHookSettings({ hooks: "nope" }, cmd)).toThrow(/"hooks" must be an object/);
    expect(() => mergeHookSettings({ hooks: { Stop: {} } }, cmd)).toThrow(/"hooks.Stop" must be an array/);
  });
});

describe("the install-hook CLI", () => {
  it("dry-runs by default, writes only with --write, keeps a backup, and is idempotent", async () => {
    const dir = tmp("cli");
    const settings = join(dir, "settings.json");
    writeFileSync(settings, JSON.stringify({ model: "opus" }));
    const dry = await run("bun", [INSTALL, "--settings", settings]);
    expect(dry.stdout).toContain("# dry run: would add UserPromptSubmit and Stop");
    expect(readFileSync(settings, "utf8")).toBe(JSON.stringify({ model: "opus" })); // untouched
    const first = await run("bun", [INSTALL, "--settings", settings, "--write"]);
    expect(first.stdout).toContain("installed: added UserPromptSubmit and Stop");
    expect(existsSync(`${settings}.bak`)).toBe(true);
    expect(readFileSync(`${settings}.bak`, "utf8")).toBe(JSON.stringify({ model: "opus" }));
    const written = JSON.parse(readFileSync(settings, "utf8")) as { model: string; hooks: Record<string, unknown[]> };
    expect(written.model).toBe("opus");
    expect(written.hooks.UserPromptSubmit).toHaveLength(1);
    expect(written.hooks.Stop).toHaveLength(1);
    const cmd = (written.hooks.Stop?.[0] as { hooks: { command: string }[] }).hooks[0]?.command as string;
    expect(cmd).toBe(hookCommand(HELIX_ROOT));
    expect(existsSync(JSON.parse(cmd.slice("node ".length)) as string)).toBe(true);
    const bytes = readFileSync(settings, "utf8");
    const second = await run("bun", [INSTALL, "--settings", settings, "--write"]);
    expect(second.stdout).toContain("already installed");
    expect(readFileSync(settings, "utf8")).toBe(bytes);
  });

  it("creates the file (and its directory) when none exists", async () => {
    const dir = tmp("fresh");
    const settings = join(dir, ".claude", "settings.json");
    await run("bun", [INSTALL, "--settings", settings, "--write"]);
    const written = JSON.parse(readFileSync(settings, "utf8")) as { hooks: Record<string, unknown[]> };
    expect(Object.keys(written.hooks).sort()).toEqual(["Stop", "UserPromptSubmit"]);
    expect(existsSync(`${settings}.bak`)).toBe(false); // nothing to back up
  });

  it("refuses a malformed file and leaves it alone", async () => {
    const dir = tmp("bad");
    const settings = join(dir, "settings.json");
    writeFileSync(settings, "{ not json");
    await expect(run("bun", [INSTALL, "--settings", settings, "--write"]))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("is not JSON") });
    expect(readFileSync(settings, "utf8")).toBe("{ not json");
    expect(existsSync(`${settings}.bak`)).toBe(false);
  });
});
