import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createIPFilter } from "./network";

export type Settings = {
  dataDir?: string;
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
      (key) => !["dataDir", "allowedIP", "trustedProxy"].includes(key),
    )
  )
    throw new Error(
      `${file} must be an object containing only optional dataDir, allowedIP and trustedProxy`,
    );
  if (
    "dataDir" in value &&
    (typeof value.dataDir !== "string" ||
      !value.dataDir.trim() ||
      value.dataDir.includes("\0"))
  )
    throw new Error(`${file}: dataDir must be a non-empty path string`);
  try {
    createIPFilter(value.allowedIP);
    if ("trustedProxy" in value)
      createIPFilter(value.trustedProxy, "trustedProxy");
  } catch (error) {
    throw new Error(`${file}: ${(error as Error).message}`);
  }
  return value;
}
