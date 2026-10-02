import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { assetFiles } from "@hoist/web/asset-files";

const target = process.argv[2];
if (target !== undefined && target !== "bun-linux-x64") {
  throw new Error(
    "Supported target: bun-linux-x64 (omit for current platform)",
  );
}
const outdir = resolve(import.meta.dir, "../../dist");
const webRoot = resolve(import.meta.dir, "../web");
const webBuild = Bun.spawn([process.execPath, "run", "build"], {
  cwd: webRoot,
  stdout: "inherit",
  stderr: "inherit",
});
if (await webBuild.exited) throw new Error("Web build failed");
const webDist = join(webRoot, "dist");
const files = assetFiles(webDist).sort();
const index = files.indexOf("index.html");
if (index < 0) throw new Error("Web build has no index.html");
const embeddedModule = [
  'import { dirname } from "node:path";',
  ...files.map(
    (file, i) =>
      `import asset${i} from ${JSON.stringify(join(webDist, file))} with { type: "file" };`,
  ),
  `export const assetsDir = dirname(asset${index});`,
  `export const staticFiles = new Map([${files.map((file, i) => `[${JSON.stringify(file === "index.html" ? "/" : `/${file}`)}, asset${i}]`).join(",")}]);`,
].join("\n");
mkdirSync(outdir, { recursive: true });
const outfile = resolve(
  outdir,
  target
    ? "hoist-linux-x64"
    : process.platform === "win32"
      ? "hoist.exe"
      : "hoist",
);
const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "src/index.ts")],
  minify: true,
  compile: { outfile, ...(target ? { target } : {}) },
  plugins: [
    {
      name: "embed-vite-output",
      setup(build) {
        build.onLoad(
          { filter: /[\\/]apps[\\/]web[\\/]src[\\/]assets\.ts$/ },
          () => ({
            contents: embeddedModule,
            loader: "ts",
            resolveDir: webDist,
          }),
        );
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exitCode = 1;
} else {
  console.log(`Built ${outfile}`);
}
