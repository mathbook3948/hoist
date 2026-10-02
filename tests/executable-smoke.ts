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
  assert.ok((await login.json()).csrf);
  const projects = await fetch(origin + "/api/projects", {
    headers: { Cookie: cookie },
  });
  assert.equal(projects.status, 200);
  assert.deepEqual((await projects.json()).projects, []);
  console.log(
    `Executable passed: CLI, SQLite, all ${files.length} embedded Vite assets, login and API with an empty PATH from a temporary directory.`,
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
