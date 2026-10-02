// Measure the compiled server only, with no requests during idle sampling.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { Store } from "../apps/server/src/store";

if (!["win32", "linux"].includes(process.platform))
  throw new Error("Supported platforms: Windows and Linux");
const root = resolve(import.meta.dir, "..");
const executable = join(
  root,
  "dist",
  process.platform === "win32" ? "hoist.exe" : "hoist",
);
const binarySha256 = createHash("sha256")
  .update(readFileSync(executable))
  .digest("hex");
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
if (revision.exitCode !== 0)
  throw new Error("Cannot determine measured commit");
const temp = mkdtempSync(join(tmpdir(), "hoist-idle-"));
const data = join(temp, "data");
const password = randomBytes(24).toString("hex");
let server: ReturnType<typeof Bun.spawn> | undefined;
const sampleCount = 30;
const intervalMs = 1000;
const settleMs = 10000;
type Reading = { residentBytes: number; privateBytes?: number };
async function sample(): Promise<Reading[]> {
  if (process.platform === "win32") {
    const script = `$ErrorActionPreference='Stop'; $samples = @(for ($i=0; $i -lt ${sampleCount}; $i++) { $targetProcess=Get-Process -Id ${server!.pid}; $targetProcess.Refresh(); [pscustomobject]@{residentBytes=$targetProcess.WorkingSet64; privateBytes=$targetProcess.PrivateMemorySize64}; Start-Sleep -Milliseconds ${intervalMs} }); ConvertTo-Json -InputObject $samples -Compress`;
    const sampler = Bun.spawn(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      sampler.exited,
      new Response(sampler.stdout).text(),
      new Response(sampler.stderr).text(),
    ]);
    if (code !== 0) throw new Error(stderr);
    return JSON.parse(stdout);
  }
  const samples: Reading[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const status = readFileSync(`/proc/${server!.pid}/status`, "utf8");
    const match = status.match(/^VmRSS:\s+(\d+) kB/m);
    if (!match) throw new Error("VmRSS is unavailable");
    samples.push({ residentBytes: Number(match[1]) * 1024 });
    await Bun.sleep(intervalMs);
  }
  return samples;
}
function summarize(readings: Reading[]) {
  const stats = (key: keyof Reading) => {
    const values = readings
      .map((r) => r[key])
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b);
    if (!values.length) return undefined;
    return {
      minMiB: values[0] / 1048576,
      medianMiB:
        (values[(values.length - 1) >> 1] + values[values.length >> 1]) /
        2 /
        1048576,
      maxMiB: values.at(-1)! / 1048576,
    };
  };
  return {
    resident: stats("residentBytes"),
    private: stats("privateBytes"),
    readings,
  };
}
try {
  const store = new Store(data);
  try {
    const reserve = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(""),
    });
    const port = reserve.port!;
    await reserve.stop(true);
    store.setConfig({ ...store.getConfig(), port });
    store.setAccount({
      username: "idle-test",
      passwordHash: await Bun.password.hash(password, {
        algorithm: "bcrypt",
        cost: 12,
      }),
    });
    store.setProject({
      id: "idle",
      name: "Idle test",
      script: executable,
      timeoutSeconds: 10,
    });
  } finally {
    store.close();
  }
  const configStore = new Store(data);
  const port = configStore.getConfig().port;
  configStore.close();
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.BUN_BE_BUN;
  delete env.HOIST_DATA_DIR;
  server = Bun.spawn([executable, "serve", "--data-dir", data], {
    cwd: temp,
    env,
    stdout: "ignore",
    stderr: "inherit",
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error("Server exited before readiness");
    try {
      const response = await fetch(origin + "/api/me");
      await response.arrayBuffer();
      ready = response.status === 401;
      if (ready) break;
    } catch {}
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("Server readiness timed out");
  console.error("Cold idle: settle 10s, sample 30s (no requests)");
  await Bun.sleep(settleMs);
  const coldIdle = summarize(await sample());
  const webDist = join(root, "apps/web/dist");
  for (const entry of readdirSync(webDist, {
    recursive: true,
    withFileTypes: true,
  }).filter((e) => e.isFile())) {
    const relative = join(entry.parentPath, entry.name)
      .slice(webDist.length + 1)
      .replaceAll("\\", "/");
    const response = await fetch(
      origin + "/" + (relative === "index.html" ? "" : relative),
    );
    if (!response.ok) throw new Error(`Asset request failed: ${relative}`);
    await response.arrayBuffer();
  }
  const login = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "idle-test", password }),
  });
  if (login.status !== 200) throw new Error("Login failed");
  await login.arrayBuffer();
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const projects = await fetch(origin + "/api/projects", {
    headers: { Cookie: cookie },
  });
  if (!projects.ok) throw new Error("Projects request failed");
  await projects.arrayBuffer();
  console.error("Authenticated idle: settle 10s, sample 30s (no requests)");
  await Bun.sleep(settleMs);
  const authenticatedIdle = summarize(await sample());
  const report = {
    measuredAt: new Date().toISOString(),
    commit: revision.stdout.toString().trim(),
    binarySha256,
    platform: process.platform,
    osRelease: release(),
    architecture: process.arch,
    bun: Bun.version,
    scope:
      "Compiled server PID only; browser, setup, sampler and deployment children excluded. One project, no uploads or deployments. No requests during samples. Cold phase follows readiness; authenticated phase follows loading all web assets, login and project listing.",
    metric:
      process.platform === "win32"
        ? "resident=Windows WorkingSet64; private=PrivateMemorySize64 (committed private memory, not private working set)"
        : "resident=Linux /proc/PID/status VmRSS",
    settleMs,
    sampleCount,
    intervalMs,
    coldIdle,
    authenticatedIdle,
  };
  const output = join(root, "dist/measurements/idle.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        ...report,
        coldIdle: { ...coldIdle, readings: undefined },
        authenticatedIdle: { ...authenticatedIdle, readings: undefined },
        output,
      },
      null,
      2,
    ),
  );
} finally {
  if (server) {
    server.kill();
    await server.exited;
  }
  rmSync(temp, { recursive: true, force: true });
}
