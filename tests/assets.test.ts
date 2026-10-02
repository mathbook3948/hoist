import { test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { assetFiles } from "../apps/web/src/asset-files";

test("source and compiled assets include nested files but ignore linked directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-assets-"));
  try {
    const assets = join(dir, "web");
    const outside = join(dir, "outside");
    mkdirSync(join(assets, "assets", "nested"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(assets, "index.html"), "index");
    writeFileSync(join(assets, "assets", "app.js"), "app");
    writeFileSync(join(assets, "assets", "nested", "style.css"), "style");
    writeFileSync(join(outside, "private.txt"), "private");
    symlinkSync(
      outside,
      join(assets, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(assetFiles(assets).sort()).toEqual([
      "assets/app.js",
      "assets/nested/style.css",
      "index.html",
    ]);
  } finally {
    if (dirname(dir) !== resolve(tmpdir()))
      throw new Error("Unexpected test directory");
    rmSync(dir, { recursive: true, force: true });
  }
});
