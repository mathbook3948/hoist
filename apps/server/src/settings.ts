import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isIP } from "node:net";
import { createIPFilter } from "./network";
import { type Config, GiB } from "./models";

export type Settings = {
  dataDir?: string;
  host?: string;
  allowedIP?: string;
  trustedProxy?: string;
};

export function readSettings(home = homedir()): Settings {
  const file = join(home, ".hoist", "settings.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read ${file}`, { cause: error });
  }
  let value: any;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`Invalid JSON in ${file}`);
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["dataDir", "host", "allowedIP", "trustedProxy"].includes(key),
    )
  )
    throw new Error(
      `${file} must be an object containing only optional dataDir, host, allowedIP and trustedProxy`,
    );
  if (
    "dataDir" in value &&
    (typeof value.dataDir !== "string" ||
      !value.dataDir.trim() ||
      value.dataDir.includes("\0"))
  )
    throw new Error(`${file}: dataDir must be a non-empty path string`);
  if (
    "host" in value &&
    (typeof value.host !== "string" ||
      (value.host !== "localhost" && !isIP(value.host)) ||
      value.host.includes("%"))
  )
    throw new Error(`${file}: host must be an IP address or localhost`);
  try {
    createIPFilter(value.allowedIP);
    if ("trustedProxy" in value)
      createIPFilter(value.trustedProxy, "trustedProxy");
  } catch (error) {
    throw new Error(`${file}: ${(error as Error).message}`);
  }
  return value;
}

export function validateConfig(c: Config) {
  if (typeof c.host !== "string" || !c.host || /[\x00-\x20\x7f]/.test(c.host))
    throw new Error("Invalid host");
  if (
    c.publicOrigin !== null &&
    (typeof c.publicOrigin !== "string" ||
      new URL(c.publicOrigin).origin !== c.publicOrigin ||
      new URL(c.publicOrigin).protocol !== "https:")
  )
    throw new Error("publicOrigin must be an HTTPS origin with no path");
  for (const [key, min, max] of [
    ["port", 1, 65535],
    ["maxArtifactBytes", 1, 64 * GiB],
    ["maxStorageBytes", 1, 1024 * GiB],
    ["uploadTimeoutSeconds", 60, 86400],
    ["artifactRetention", 1, 100],
    ["historyRetention", 1, 100],
    ["maxLogBytes", 1024, 1024 * 1024],
    ["sessionHours", 1, 24],
  ] as const)
    if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max)
      throw new Error(`Invalid ${key}`);
}
