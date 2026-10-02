import { test, expect, spyOn } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
  readdirSync,
  symlinkSync,
  mkdirSync,
  truncateSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { initData, atomicJSON } from "../src/store";
const root = join(import.meta.dir, "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
test("CLI setup, authentication, upload boundaries, deployment argv, locks, bounded logs, cancel, timeout and restart", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-test-"));
  const data = join(tmp, "data");
  const password = randomBytes(20).toString("hex");
  let server: ReturnType<typeof Bun.spawn> | undefined;
  const cli = async (args: string[], input?: string) => {
    const p = Bun.spawn(
      [
        process.execPath,
        join(root, "src/main.ts"),
        ...args,
        "--data-dir",
        data,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        stdin: input === undefined ? "ignore" : "pipe",
      },
    );
    if (input !== undefined) {
      p.stdin.write(input);
      p.stdin.end();
    }
    const code = await p.exited;
    if (code) throw new Error(await new Response(p.stderr).text());
    return await new Response(p.stdout).text();
  };
  try {
    await cli(["init"]);
    expect(existsSync(join(data, "config.json"))).toBe(true);
    expect(statSync(join(data, "config.json")).mode & 0o777).toBe(0o600);
    await cli(["user", "set", "tester", "--password-stdin"], password + "\n");
    mkdirSync(join(tmp, "real"));
    symlinkSync(join(tmp, "real"), join(tmp, "alias"));
    expect(initData(join(tmp, "alias", "nested")).dir).toBe(
      join(tmp, "real", "nested"),
    );
    const config = JSON.parse(readFileSync(join(data, "config.json"), "utf8"));
    expect(config.accounts[0].passwordHash).not.toContain(password);
    expect(config.accounts[0].passwordHash.startsWith("$2")).toBe(true);
    const script = join(tmp, "deploy.sh");
    const marker = join(tmp, "injected");
    writeFileSync(
      script,
      `#!/bin/sh\nset -eu\nprintf 'artifact=%s\\nversion=%s\\n' "$1" "$2"\ncase "$2" in slow*) sleep 8;; noisy) head -c 200000 /dev/zero | tr '\\0' X;; fail) exit 7;; esac\n`,
    );
    await cli([
      "project",
      "set",
      "demo",
      "--script",
      script,
      "--name",
      "Test",
      "--timeout",
      "2",
    ]);
    const reserve = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(""),
    });
    const port = reserve.port;
    await reserve.stop(true);
    const origin = `http://127.0.0.1:${port}`;
    const cfg = JSON.parse(readFileSync(join(data, "config.json"), "utf8"));
    cfg.port = port;
    cfg.maxArtifactBytes = 1024 * 1024;
    cfg.maxLogBytes = 4096;
    cfg.artifactRetention = 2;
    atomicJSON(join(data, "config.json"), cfg);
    const start = async () => {
      server = Bun.spawn(
        [
          process.execPath,
          join(root, "src/main.ts"),
          "serve",
          "--data-dir",
          data,
        ],
        { stdout: "ignore", stderr: "pipe" },
      );
      for (let i = 0; i < 80; i++) {
        try {
          if ((await fetch(origin + "/api/me")).status === 401) return;
        } catch {}
        await sleep(50);
      }
      throw new Error("Server failed to start");
    };
    await start();
    for (const [path, mime] of [
      ["/", "text/html"],
      ["/app.js", "text/javascript"],
      ["/style.css", "text/css"],
    ]) {
      const r = await fetch(origin + path);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain(mime);
      expect(r.headers.get("content-security-policy")).toContain(
        "script-src 'self'",
      );
      expect((await r.text()).length).toBeGreaterThan(100);
    }
    let cookie = "",
      csrf = "";
    const api = async (
      path: string,
      method = "GET",
      body?: BodyInit,
      extra: Record<string, string> = {},
    ) =>
      fetch(origin + path, {
        method,
        body,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method !== "GET" ? { Origin: origin, "X-CSRF-Token": csrf } : {}),
          ...extra,
        },
      });
    expect((await api("/api/projects")).status).toBe(401);
    expect((await api("/../config.json")).status).toBe(401);
    expect(
      (
        await fetch(origin + "/api/login", {
          method: "POST",
          headers: {
            Origin: "https://evil.invalid",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username: "tester", password }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          "/api/login",
          "POST",
          JSON.stringify({ username: "unknown", password }),
          { "Content-Type": "application/json" },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await api(
          "/api/login",
          "POST",
          JSON.stringify({ username: "tester", password: "wrong password" }),
          { "Content-Type": "application/json" },
        )
      ).status,
    ).toBe(401);
    const parallel = await Promise.all(
      Array.from({ length: 8 }, () =>
        api(
          "/api/login",
          "POST",
          JSON.stringify({
            username: "tester",
            password: "concurrent bad password",
          }),
          { "Content-Type": "application/json" },
        ),
      ),
    );
    expect(parallel.filter((r) => r.status === 401).length).toBe(1);
    expect(parallel.filter((r) => r.status === 429).length).toBe(7);
    const login = await api(
      "/api/login",
      "POST",
      JSON.stringify({ username: "tester", password }),
      { "Content-Type": "application/json" },
    );
    expect(login.status).toBe(200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    csrf = (await login.json()).csrf;
    expect(login.headers.get("set-cookie")!.startsWith("hoist_session=")).toBe(
      true,
    );
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(
      (
        await api("/api/projects/demo/artifacts", "POST", "a", {
          "X-CSRF-Token": "bad",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api("/api/projects/demo/artifacts", "POST", "a", {
          "X-Artifact-Name": "..%2Fconfig.json",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api("/api/projects/demo/artifacts", "POST", "a", {
          "X-Artifact-Name": "%00bad",
        })
      ).status,
    ).toBe(400);
    expect(
      (await api("/api/projects/unknown/artifacts", "POST", "a")).status,
    ).toBe(404);
    expect(
      (
        await api(
          "/api/projects/demo/artifacts",
          "POST",
          new Uint8Array(1024 * 1024 + 1),
        )
      ).status,
    ).toBe(413);
    expect((await api("/api/projects/demo/artifacts", "POST", "")).status).toBe(
      400,
    );
    const oversize = await fetch(origin + "/api/projects/demo/artifacts", {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": csrf },
      body: new ReadableStream({
        async pull(c) {
          c.enqueue(new Uint8Array(700000));
          await sleep(10);
          c.enqueue(new Uint8Array(700000));
          c.close();
        },
      }),
    });
    expect(oversize.status).toBe(413);
    expect(readdirSync(join(data, "projects/demo/artifacts")).length).toBe(0);
    const uploaded = await api(
      "/api/projects/demo/artifacts",
      "POST",
      "prebuilt artifact",
      { "X-Artifact-Name": encodeURIComponent("build; touch nope.tar") },
    );
    expect(uploaded.status).toBe(201);
    const artifact = (await uploaded.json()).artifact;
    expect(artifact.name).toBe("build; touch nope.tar");
    expect(readdirSync(join(data, "projects/demo/artifacts"))).toEqual([
      artifact.id + ".bin",
    ]);
    const deploy = async (version: string) => {
      const r = await api(
        "/api/projects/demo/deploy",
        "POST",
        JSON.stringify({ artifactId: artifact.id, version }),
        { "Content-Type": "application/json" },
      );
      expect(r.status).toBe(202);
      return (await r.json()).deployment;
    };
    const status = async (id: string) => {
      const r = await api(`/api/projects/demo/deployments/${id}`);
      expect(r.status).toBe(200);
      return r.json();
    };
    const finish = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const r = await status(id);
        if (r.deployment.status !== "running") return r;
        await sleep(50);
      }
      throw new Error("Deployment did not finish");
    };
    expect(
      (
        await api(
          "/api/projects/demo/deploy",
          "POST",
          JSON.stringify({ artifactId: "../evil", version: "x" }),
          { "Content-Type": "application/json" },
        )
      ).status,
    ).toBe(404);
    const attack = `release; touch ${marker}; $(touch ${marker})`;
    const injected = await finish((await deploy(attack)).id);
    expect(injected.deployment.status).toBe("succeeded");
    expect(injected.log).toContain(attack);
    expect(existsSync(marker)).toBe(false);
    const failed = await finish((await deploy("fail")).id);
    expect(failed.deployment.status).toBe("failed");
    expect(failed.deployment.exitCode).toBe(7);
    const noisy = await finish((await deploy("noisy")).id);
    expect(Buffer.byteLength(noisy.log)).toBeLessThan(4200);
    expect(noisy.log).toContain("log limit");
    const slow = await deploy("slow-cancel");
    expect(
      (
        await api(
          "/api/projects/demo/deploy",
          "POST",
          JSON.stringify({ artifactId: artifact.id, version: "x" }),
          { "Content-Type": "application/json" },
        )
      ).status,
    ).toBe(409);
    expect(
      (await api("/api/projects/demo/artifacts", "POST", "x")).status,
    ).toBe(409);
    expect(
      (await api(`/api/projects/demo/deployments/${slow.id}/cancel`, "POST"))
        .status,
    ).toBe(200);
    expect((await finish(slow.id)).deployment.status).toBe("cancelled");
    expect(
      (await api(`/api/projects/demo/deployments/${slow.id}/cancel`, "POST"))
        .status,
    ).toBe(409);
    expect(
      (await finish((await deploy("slow-timeout")).id)).deployment.status,
    ).toBe("timed_out");
    const blocked = await Bun.spawn(
      [
        process.execPath,
        join(root, "src/main.ts"),
        "user",
        "list",
        "--data-dir",
        data,
      ],
      { stdout: "ignore", stderr: "ignore" },
    ).exited;
    expect(blocked).toBe(1);
    const archived = join(data, "projects/archived/artifacts");
    mkdirSync(archived, { recursive: true });
    writeFileSync(join(archived, "old.bin"), "");
    truncateSync(join(archived, "old.bin"), 512 * 1024 * 1024);
    expect(
      (await api("/api/projects/demo/artifacts", "POST", "quota probe")).status,
    ).toBe(413);
    rmSync(join(data, "projects/archived"), { recursive: true });
    expect((await api("/api/logout", "POST")).status).toBe(200);
    expect((await api("/api/projects")).status).toBe(401);
    // Streamed oversize bodies without a Content-Length must also stop and clean partial files.
    const beforeFiles = readdirSync(
      join(data, "projects/demo/artifacts"),
    ).length;
    expect(
      (
        await fetch(origin + "/api/projects/demo/artifacts", {
          method: "POST",
          headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": csrf },
          body: new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(700000));
              c.enqueue(new Uint8Array(700000));
              c.close();
            },
          }),
        })
      ).status,
    ).toBe(401);
    // The prior logout means this must fail before body processing.
    expect(readdirSync(join(data, "projects/demo/artifacts")).length).toBe(
      beforeFiles,
    );
    server!.kill("SIGTERM");
    expect(await server!.exited).toBe(0);
    await start();
    expect(
      (await fetch(origin + "/api/projects", { headers: { Cookie: cookie } }))
        .status,
    ).toBe(401);
    expect(
      JSON.parse(readFileSync(join(data, "projects/demo/state.json"), "utf8"))
        .deployments.length,
    ).toBe(5);
    for (let i = 0; i < 10; i++)
      expect(
        (
          await api("/api/login", "POST", "null", {
            "Content-Type": "application/json",
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await api(
          "/api/login",
          "POST",
          JSON.stringify({ username: "tester", password }),
          { "Content-Type": "application/json" },
        )
      ).status,
    ).toBe(429);
    server!.kill("SIGTERM");
    await server!.exited;
    server = undefined;
    await cli(["user", "remove", "tester"]);
    expect(
      JSON.parse(readFileSync(join(data, "config.json"), "utf8")).accounts
        .length,
    ).toBe(0);
  } finally {
    if (server) {
      server.kill("SIGTERM");
      await server.exited;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}, 30000);

import { smallJSON, startServer } from "../src/server";
test("JSON body absolute deadline cancels a trickling request", async () => {
  let cancelled = false;
  const req = new Request("http://127.0.0.1/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("{"));
      },
      cancel() {
        cancelled = true;
      },
    }),
  });
  await expect(smallJSON(req)).rejects.toThrow("deadline");
  expect(cancelled).toBe(true);
}, 12000);

import { main } from "../src/main";
test("a symlinked data-directory ancestor cannot register an uploaded artifact as script", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-path-"));
  try {
    mkdirSync(join(tmp, "real"));
    symlinkSync(join(tmp, "real"), join(tmp, "alias"));
    const canonical = initData(join(tmp, "alias", "data")).dir;
    const artifacts = join(canonical, "projects/demo/artifacts");
    mkdirSync(artifacts, { recursive: true });
    const payload = join(artifacts, "payload.bin");
    writeFileSync(payload, "#!/bin/sh\nexit 0\n");
    await expect(
      main([
        "project",
        "set",
        "demo",
        "--script",
        payload,
        "--data-dir",
        join(tmp, "alias", "data"),
      ]),
    ).rejects.toThrow("cannot be registered");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("an unknown username cannot get a session even if dummy verification returns true", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-auth-"));
  const { config } = initData(tmp);
  const reserve = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(""),
  });
  config.port = reserve.port;
  await reserve.stop(true);
  const verify = spyOn(Bun.password, "verify").mockResolvedValue(true);
  let runtime: ReturnType<typeof startServer> | undefined;
  try {
    runtime = startServer(tmp, config);
    const origin = `http://127.0.0.1:${config.port}`;
    const response = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "unknown-fixture",
        password: "synthetic-only-password",
      }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(verify).toHaveBeenCalled();
  } finally {
    verify.mockRestore();
    if (runtime) await runtime.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
});
