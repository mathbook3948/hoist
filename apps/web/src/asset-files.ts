import { readdirSync } from "node:fs";
import { join } from "node:path";

export function assetFiles(dir: string): string[] {
  const files: string[] = [];
  // Walk explicitly: Bun's recursive readdir follows linked directories.
  function collect(current: string, prefix = "") {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory())
        collect(join(current, entry.name), `${relative}/`);
      else if (entry.isFile()) files.push(relative);
    }
  }
  collect(dir);
  return files;
}
