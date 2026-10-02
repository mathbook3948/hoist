import { readSettings } from "./settings";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Shared by installed CLI/server; development entry points supply their own default. */
export function resolveDataDir(
  explicit?: string,
  options: {
    developmentDataDir?: string;
    home?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  function path(value: unknown, base: string, source: string): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
      throw new Error(`${source}: dataDir must be a non-empty path string`);
    }
    if (value === "~") return home;
    if (/^~[\\/]/.test(value)) return resolve(home, value.slice(2));
    return resolve(base, value);
  }
  if (explicit !== undefined) return path(explicit, cwd, "--data-dir");
  if (env.HOIST_DATA_DIR !== undefined)
    return path(env.HOIST_DATA_DIR, cwd, "HOIST_DATA_DIR");
  if (options.developmentDataDir !== undefined)
    return path(options.developmentDataDir, cwd, "Development default");

  const configDir = join(home, ".hoist");
  const settingsPath = join(configDir, "settings.json");
  const settings = readSettings(home);
  return "dataDir" in settings
    ? path(settings.dataDir, configDir, settingsPath)
    : join(configDir, "data");
}
