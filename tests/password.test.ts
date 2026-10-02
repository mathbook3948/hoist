import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../apps/server/src/store";
import { createAuth } from "../apps/server/src/auth";

test("piped account setup accepts unrestricted non-empty passwords and preserves accounts on failure", async () => {
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
    expect((await run(["--password-stdin"], "\n")).code).toBe(1);
    const check = new Store(dir);
    expect(check.getAccount()).toEqual(original);
    check.close();
    for (const value of [
      "a",
      "가".repeat(30),
      "a".repeat(72) + "suffix",
      "with\tcontrols\n\u0000end",
    ]) {
      expect((await run(["--password-stdin"], value + "\n")).code).toBe(0);
      const updated = new Store(dir);
      try {
        const origin = "http://127.0.0.1";
        const auth = createAuth(updated, updated.getConfig(), origin);
        const request = (password: string) =>
          new Request(origin + "/api/login", {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify({ username: "admin", password }),
          });
        expect((await auth.login(request(value), "test")).status).toBe(200);
        await expect(
          auth.login(request(value + "wrong"), "test"),
        ).rejects.toThrow("Invalid credentials");
      } finally {
        updated.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
