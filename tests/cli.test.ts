import { test, expect, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { main } from "../apps/cli/src/main";
import { Store } from "../apps/server/src/store";

test("CLI dispatch preserves settings, project commands, validation and lock cleanup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-cli-"));
  const output = spyOn(console, "log").mockImplementation(() => {});
  const run = (...args: string[]) => main([...args, "--data-dir", dir]);
  function inspect<T>(read: (store: Store) => T): T {
    const store = new Store(dir);
    try {
      return read(store);
    } finally {
      store.close();
    }
  }
  try {
    await run("init");
    expect(output).toHaveBeenLastCalledWith(
      `Database ready: ${join(dir, "hoist.sqlite")}`,
    );
    await run("config", "set", "port", "3101");
    await run("config", "set", "publicOrigin", "https://example.test");
    await run("config", "set", "publicOrigin", "null");
    await run("config", "list");
    expect(JSON.parse(output.mock.calls.at(-1)![0])).toMatchObject({
      port: 3101,
      publicOrigin: null,
    });

    await run("project", "create", "Demo", "--timeout", "25");
    const project = inspect((store) => store.getProjects()[0]);
    expect(project).toMatchObject({ name: "Demo", timeoutSeconds: 25 });
    const script = readFileSync(project.script, "utf8");
    await run("project", "list");
    expect(output).toHaveBeenLastCalledWith(
      `${project.id}\tDemo\t${project.script}`,
    );
    await run("project", "set", project.id, "--script", project.script);
    expect(inspect((store) => store.getProject(project.id))).toMatchObject({
      name: project.id,
      timeoutSeconds: 300,
    });
    expect(readFileSync(project.script, "utf8")).toBe(script);
    await run("project", "remove", project.id);
    expect(inspect((store) => store.getProjects())).toEqual([]);
    expect(existsSync(project.script)).toBe(false);

    inspect((store) =>
      store.setAccount({ username: "admin", passwordHash: "$2b$fixture" }),
    );
    await run("user", "list");
    expect(output).toHaveBeenLastCalledWith("admin");
    await run("user", "remove", "admin");
    await run("user", "list");
    expect(output).toHaveBeenLastCalledWith("(no accounts)");

    for (const [args, message] of [
      [["--unknown"], "Unknown/incomplete option"],
      [["config", "set", "port", "bad"], "Invalid port"],
      [["config", "set", "missing", "1"], "Unknown/incomplete setting"],
      [["user", "remove"], "Invalid username"],
      [["project", "remove", "../invalid"], "Invalid project ID"],
      [["config", "unknown"], "Unknown command. Use --help"],
    ] as const) {
      await expect(run(...args)).rejects.toThrow(message);
      expect(existsSync(join(dir, "runtime.lock"))).toBe(false);
    }
    expect(inspect((store) => store.getConfig().port)).toBe(3101);
  } finally {
    output.mockRestore();
    if (dirname(dir) !== resolve(tmpdir()))
      throw new Error("Unexpected test directory");
    rmSync(dir, { recursive: true, force: true });
  }
});
