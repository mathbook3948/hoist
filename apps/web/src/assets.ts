import { existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

// Source runs serve Vite's output. The CLI build replaces this module with embedded imports.
export const assetsDir = resolve(import.meta.dir, "../dist");
export const staticFiles = new Map<string, string>();
function collect(dir: string, prefix = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) collect(join(dir, entry.name), `${relative}/`);
    else if (entry.isFile())
      staticFiles.set(
        relative === "index.html" ? "/" : `/${relative}`,
        join(dir, entry.name),
      );
  }
}
if (existsSync(assetsDir)) collect(assetsDir);
