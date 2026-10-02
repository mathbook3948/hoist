import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { assetFiles } from "./asset-files";

// Source runs serve Vite's output. The CLI build replaces this module with embedded imports.
export const assetsDir = resolve(import.meta.dir, "../dist");
export const staticFiles = new Map<string, string>();
if (existsSync(assetsDir)) {
  for (const path of assetFiles(assetsDir)) {
    staticFiles.set(
      path === "index.html" ? "/" : `/${path}`,
      join(assetsDir, path),
    );
  }
}
