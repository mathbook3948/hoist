import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDataDir } from "../apps/server/src/paths";

function fixture(run: (home: string, write: (text: string) => void) => void) {
  const home = mkdtempSync(join(tmpdir(), "hoist-paths-"));
  try {
    mkdirSync(join(home, ".hoist"));
    run(home, (text) =>
      writeFileSync(join(home, ".hoist/settings.json"), text),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("installed defaults and settings paths do not depend on the working directory", () => {
  fixture((home, write) => {
    const context = { home, cwd: join(home, "elsewhere"), env: {} };
    expect(resolveDataDir(undefined, context)).toBe(join(home, ".hoist/data"));
    write("{}");
    expect(resolveDataDir(undefined, context)).toBe(join(home, ".hoist/data"));
    write('\uFEFF{"dataDir":"storage"}');
    expect(resolveDataDir(undefined, context)).toBe(
      join(home, ".hoist/storage"),
    );
    write('{"dataDir":"~/my-data"}');
    expect(resolveDataDir(undefined, context)).toBe(join(home, "my-data"));
    write(JSON.stringify({ dataDir: join(home, "absolute") }));
    expect(resolveDataDir(undefined, context)).toBe(join(home, "absolute"));
  });
});

test("explicit path and environment override settings, while development skips home settings", () => {
  fixture((home, write) => {
    write("invalid JSON");
    const developmentDataDir = join(home, "repo/.data");
    const context = {
      home,
      cwd: home,
      env: { HOIST_DATA_DIR: "environment" },
      developmentDataDir,
    };
    expect(resolveDataDir("explicit", context)).toBe(join(home, "explicit"));
    expect(resolveDataDir(undefined, context)).toBe(join(home, "environment"));
    expect(resolveDataDir(undefined, { ...context, env: {} })).toBe(
      developmentDataDir,
    );
    expect(() =>
      resolveDataDir(undefined, {
        ...context,
        env: {},
        developmentDataDir: undefined,
      }),
    ).toThrow("Invalid JSON");
  });
});

test("invalid settings and empty overrides fail instead of silently selecting another database", () => {
  fixture((home, write) => {
    const context = { home, env: {} };
    for (const text of [
      "null",
      "[]",
      '{"dataDir":null}',
      '{"dataDir":42}',
      '{"dataDir":" "}',
      '{"dataDir":"bad\\u0000path"}',
      '{"dataDirectory":"typo"}',
    ]) {
      write(text);
      expect(() => resolveDataDir(undefined, context)).toThrow();
    }
    expect(() => resolveDataDir("", context)).toThrow("--data-dir");
    expect(() =>
      resolveDataDir(undefined, { ...context, env: { HOIST_DATA_DIR: "" } }),
    ).toThrow("HOIST_DATA_DIR");
  });
});
