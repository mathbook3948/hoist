import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const root = resolve(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "hoist-binary-"));
const name = process.platform === "win32" ? "hoist.exe" : "hoist";
const executable = join(tmp, name);
const data = join(tmp, "data");
const home = join(tmp, "home");
const password = randomBytes(24).toString("hex");
const env = { ...process.env, PATH: "", HOME: home, USERPROFILE: home };
delete env.BUN_BE_BUN;
delete env.HOIST_DATA_DIR;
let server: ReturnType<typeof Bun.spawn> | undefined;

async function cli(args: string[], input?: string) {
  const child = Bun.spawn([executable, ...args], {
    cwd: tmp,
    env,
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined) {
    child.stdin.write(input);
    child.stdin.end();
  }
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, stderr);
  return stdout;
}

try {
  copyFileSync(join(root, "dist", name), executable);
  assert.match(await cli(["--help"]), /hoist serve/);
  mkdirSync(home);
  const homeProbe = Bun.spawnSync(
    [process.execPath, "-e", 'console.log(require("node:os").homedir())'],
    { env },
  );
  assert.equal(
    homeProbe.stdout.toString().trim(),
    home,
    "Test HOME must be isolated",
  );
  await cli(["init"]);
  assert.ok(existsSync(join(home, ".hoist/data/hoist.sqlite")));
  writeFileSync(
    join(home, ".hoist/settings.json"),
    JSON.stringify({ dataDir: data }),
  );
  await cli(["init"]);
  const migrated = new Database(join(data, "hoist.sqlite"), { readonly: true });
  try {
    assert.deepEqual(
      migrated.query("SELECT id FROM schema_migrations ORDER BY id").all(),
      [{ id: 1 }],
    );
  } finally {
    migrated.close();
  }
  await cli(["user", "set", "admin", "--password-stdin"], password + "\n");
  assert.match(await cli(["user", "list"]), /admin/);
  const reserve = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(""),
  });
  const port = reserve.port;
  await reserve.stop(true);
  await cli(["config", "set", "port", String(port)]);
  const origin = `http://127.0.0.1:${port}`;
  server = Bun.spawn([executable, "serve"], {
    cwd: tmp,
    env,
    stdout: "ignore",
    stderr: "inherit",
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Executable exited early");
    try {
      ready = (await fetch(origin + "/api/me")).status === 401;
      if (ready) break;
    } catch {}
    await Bun.sleep(50);
  }
  assert.ok(ready, "Compiled server did not become ready");
  const detailPage = await fetch(origin + "/example-project");
  assert.equal(detailPage.status, 200);
  assert.match(detailPage.headers.get("content-type") || "", /text\/html/);
  assert.equal(
    await detailPage.text(),
    await Bun.file(join(root, "apps/web/dist/index.html")).text(),
  );
  assert.notEqual(
    (await fetch(origin + "/api/unknown")).headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  const webDist = join(root, "apps/web/dist");
  const files = readdirSync(webDist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(webDist.length + 1)
        .replaceAll("\\", "/"),
    );
  assert.ok(files.includes("index.html"));
  assert.ok(files.some((file) => file.endsWith(".js")));
  assert.ok(files.some((file) => file.endsWith(".css")));
  for (const file of files) {
    const response = await fetch(
      origin + (file === "index.html" ? "/" : `/${file}`),
    );
    assert.equal(response.status, 200, file);
    assert.ok(response.headers.get("content-security-policy"), file);
    assert.equal(
      await response.text(),
      await Bun.file(join(webDist, file)).text(),
      `Embedded asset mismatch: ${file}`,
    );
  }
  const login = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.match(cookie, /^hoist\.session=[a-f0-9]{64}$/);
  assert.match(login.headers.get("set-cookie")!, /Max-Age=28800/);
  const csrf = (await login.json()).csrf;
  assert.ok(csrf);
  const projects = await fetch(origin + "/api/projects", {
    headers: { Cookie: cookie },
  });
  assert.equal(projects.status, 200);
  assert.deepEqual((await projects.json()).projects, []);
  const projectHeaders = {
    Cookie: cookie,
    Origin: origin,
    "X-CSRF-Token": csrf,
    "Content-Type": "application/json",
  };
  const created = await fetch(origin + "/api/projects", {
    method: "POST",
    headers: projectHeaders,
    body: JSON.stringify({ name: "Managed script" }),
  });
  assert.equal(created.status, 201);
  const { project } = await created.json();
  assert.match(project.id, /^[0-9a-f-]{36}$/);
  assert.equal(project.script, join(data, "projects", project.id, "deploy.sh"));
  const scriptContent = '#!/bin/sh\nprintf "%s\\n" "$2"\n';
  const updated = await fetch(origin + `/api/projects/${project.id}`, {
    method: "PUT",
    headers: projectHeaders,
    body: JSON.stringify({ name: "Managed script", scriptContent }),
  });
  assert.equal(updated.status, 200);
  const scriptResponse = await fetch(
    origin + `/api/projects/${project.id}/script`,
    { headers: { Cookie: cookie } },
  );
  assert.equal((await scriptResponse.json()).scriptContent, scriptContent);
  assert.equal(await Bun.file(project.script).text(), scriptContent);
  const oldCookie = cookie.replace("hoist.session=", "hoist_session=");
  assert.equal(
    (await fetch(origin + "/api/me", { headers: { Cookie: oldCookie } }))
      .status,
    401,
  );
  const logout = await fetch(origin + "/api/logout", {
    method: "POST",
    headers: projectHeaders,
  });
  assert.equal(logout.status, 200);
  assert.match(
    logout.headers.get("set-cookie")!,
    /^hoist\.session=;.*Max-Age=0/,
  );
  assert.equal(
    (await fetch(origin + "/api/me", { headers: { Cookie: cookie } })).status,
    401,
  );
  server.kill();
  await server.exited;
  writeFileSync(
    join(home, ".hoist/settings.json"),
    JSON.stringify({ dataDir: data, allowedIP: "100.64.0.0/10" }),
  );
  // Explicit data-dir must not bypass the home network policy.
  server = Bun.spawn([executable, "serve", "--data-dir", data], {
    cwd: tmp,
    env,
    stdout: "ignore",
    stderr: "inherit",
  });
  ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error("Filtered executable exited early");
    try {
      const response = await fetch(origin + "/", {
        headers: { "X-Forwarded-For": "100.80.1.2" },
      });
      if (
        response.status === 403 &&
        (await response.json()).error === "IP address rejected"
      ) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(50);
  }
  assert.ok(ready, "Compiled server must load allowedIP even with --data-dir");
  server.kill();
  await server.exited;
  writeFileSync(
    join(home, ".hoist/settings.json"),
    JSON.stringify({
      dataDir: data,
      allowedIP: "100.64.0.0/10",
      trustedProxy: "127.0.0.1",
    }),
  );
  server = Bun.spawn([executable, "serve", "--data-dir", data], {
    cwd: tmp,
    env,
    stdout: "ignore",
    stderr: "inherit",
  });
  ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error("Proxy-enabled executable exited early");
    try {
      const response = await fetch(origin + "/api/me", {
        headers: { "X-Forwarded-For": "100.80.1.2" },
      });
      if (response.status === 401) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(50);
  }
  assert.ok(ready, "Compiled server must load trustedProxy from settings");
  assert.equal((await fetch(origin + "/api/me")).status, 403);
  assert.equal(
    (
      await fetch(origin + "/api/me", {
        headers: { "X-Forwarded-For": "100.80.1.2,192.0.2.1" },
      })
    ).status,
    403,
  );
  server.kill();
  await server.exited;
  writeFileSync(
    join(home, ".hoist/settings.json"),
    JSON.stringify({ dataDir: data, allowedIP: "invalid" }),
  );
  const invalid = Bun.spawn([executable, "serve", "--data-dir", data], {
    cwd: tmp,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, error] = await Promise.all([
    invalid.exited,
    new Response(invalid.stderr).text(),
  ]);
  assert.notEqual(exitCode, 0);
  assert.match(error, /Invalid allowedIP/);
  console.log(
    `Executable passed: CLI, SQLite, all ${files.length} embedded Vite assets, login, API and settings IP policy with an empty PATH from a temporary directory.`,
  );
} finally {
  if (server) {
    server.kill();
    await server.exited;
  }
  if (
    dirname(resolve(tmp)) !== resolve(tmpdir()) ||
    !basename(tmp).startsWith("hoist-binary-")
  ) {
    throw new Error("Unexpected temporary directory; refusing cleanup");
  }
  rmSync(tmp, { recursive: true, force: true });
}
