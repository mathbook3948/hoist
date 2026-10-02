// Real Linux RSS measurements, server PID only. Temporary credentials are never printed.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { initData, atomicJSON } from "../src/store";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(join(tmpdir(), "hoist-rss-"));
const data = join(tmp, "data");
const { config } = initData(data);
const reserve = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(""),
});
config.port = reserve.port;
await reserve.stop(true);
const password = randomBytes(20).toString("hex");
config.accounts = [
  {
    username: "rss-test",
    passwordHash: await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 12,
    }),
  },
];
config.projects = [
  {
    id: "memory",
    name: "Memory test",
    script: "/bin/true",
    timeoutSeconds: 10,
  },
];
atomicJSON(join(data, "config.json"), config);
const p = Bun.spawn(
  [
    process.execPath,
    join(import.meta.dir, "../src/main.ts"),
    "serve",
    "--data-dir",
    data,
  ],
  { stdout: "ignore", stderr: "pipe" },
);
const origin = `http://127.0.0.1:${config.port}`;
const rss = () =>
  Number(
    readFileSync(`/proc/${p.pid}/status`, "utf8").match(
      /^VmRSS:\s+(\d+) kB/m,
    )![1],
  );
async function sample(ms: number) {
  const readings: number[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    readings.push(rss());
    await sleep(20);
  }
  return {
    minKiB: Math.min(...readings),
    maxKiB: Math.max(...readings),
    lastKiB: readings.at(-1),
    samples: readings.length,
  };
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(origin + "/api/me");
      break;
    } catch {}
    await sleep(30);
  }
  const coldIdle = await sample(2000);
  let loginPeak = rss();
  const loginTimer = setInterval(
    () => (loginPeak = Math.max(loginPeak, rss())),
    20,
  );
  const login = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "rss-test", password }),
  });
  clearInterval(loginTimer);
  if (login.status !== 200) throw new Error("Login failed");
  const csrf = (await login.json()).csrf;
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  await sleep(1000);
  const authenticatedIdle = await sample(2000);
  const bytes = 64 * 1024 * 1024;
  let sent = 0;
  const chunk = new Uint8Array(64 * 1024);
  let uploadPeak = rss();
  const timer = setInterval(
    () => (uploadPeak = Math.max(uploadPeak, rss())),
    10,
  );
  const started = Date.now();
  const upload = await fetch(origin + "/api/projects/memory/artifacts", {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      "X-Artifact-Name": "memory-test.bin",
    },
    body: new ReadableStream({
      async pull(c) {
        if (sent >= bytes) {
          c.close();
          return;
        }
        c.enqueue(chunk);
        sent += chunk.length;
        await sleep(1);
      },
    }),
  });
  clearInterval(timer);
  if (upload.status !== 201) throw new Error(`Upload failed: ${upload.status}`);
  const uploadMs = Date.now() - started;
  await sleep(5000);
  const postUploadIdle = await sample(2000);
  console.log(
    JSON.stringify(
      {
        bun: Bun.version,
        platform: process.platform,
        architecture: process.arch,
        scope:
          "Only Bun server PID VmRSS from /proc; test client, setup password hashing, OS page cache and deployment children excluded. No deployment child ran.",
        sampleIntervalMs: { idle: 20, upload: 10 },
        coldIdle,
        loginPeakKiB: loginPeak,
        authenticatedIdle,
        upload: { bytes, durationMs: uploadMs, peakKiB: uploadPeak },
        postUploadIdle,
      },
      null,
      2,
    ),
  );
} finally {
  p.kill("SIGTERM");
  await p.exited;
  rmSync(tmp, { recursive: true, force: true });
}
