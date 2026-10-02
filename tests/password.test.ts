import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../apps/server/src/store";
import { validatePassword } from "../apps/cli/src/password";

test("password policy validates UTF-8 byte length and control characters", () => {
  expect(validatePassword("a".repeat(12))).toBe(true);
  expect(validatePassword("가".repeat(24))).toBe(true);
  for (const value of [
    "short",
    "가".repeat(25),
    "a".repeat(73),
    "long-password\n",
    "long-password\u0000",
  ]) {
    expect(validatePassword(value)).not.toBe(true);
  }
});

test("piped account setup is explicit, validates passwords and releases its lock on failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-password-"));
  const secret = "synthetic-pipe-password";
  async function run(args: string[], input: string) {
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../apps/cli/src/index.ts"),
        "user",
        "set",
        "admin",
        "--data-dir",
        dir,
        ...args,
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    child.stdin.write(input);
    child.stdin.end();
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stdout + stderr).not.toContain(secret);
    expect(existsSync(join(dir, "runtime.lock"))).toBe(false);
    return { code, stdout, stderr };
  }
  try {
    const saved = await run(["--password-stdin"], secret + "\r\n");
    expect(saved.code).toBe(0);
    const store = new Store(dir);
    const original = store.getAccount();
    store.close();
    expect(await Bun.password.verify(secret, original!.passwordHash)).toBe(
      true,
    );
    const noTerminal = await run([], secret);
    expect(noTerminal.code).toBe(1);
    expect(noTerminal.stderr).toContain("requires a terminal");
    expect((await run(["--password-stdin"], "short\n")).code).toBe(1);
    const check = new Store(dir);
    expect(check.getAccount()).toEqual(original);
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
