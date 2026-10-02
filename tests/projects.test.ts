import { test, expect } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, GiB, defaultLimits } from "../src/store";
import { startServer } from "../src/server";
import { main } from "../src/main";

async function fixture(tmp: string) {
  const dir = join(tmp, "data");
  const store = new Store(dir);
  const config = store.getConfig();
  const reserve = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(""),
  });
  config.port = reserve.port;
  await reserve.stop(true);
  const password = "synthetic-admin-password";
  store.setAccount({
    username: "admin",
    passwordHash: await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 12,
    }),
  });
  store.setConfig(config);
  const runtime = startServer(store);
  const origin = `http://127.0.0.1:${config.port}`;
  const login = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  if (login.status !== 200) {
    await runtime.stop();
    throw new Error("Fixture login failed");
  }
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const csrf = (await login.json()).csrf;
  const headers = { Cookie: cookie, Origin: origin, "X-CSRF-Token": csrf };
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(origin + path, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { dir, store, config, runtime, origin, headers, call };
}

test("SQLite defaults, settings CLI validation, runtime locking and single administrator", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-config-"));
  const store = new Store(tmp);
  try {
    const config = store.getConfig();
    expect(config.maxArtifactBytes).toBe(GiB);
    expect(config.maxStorageBytes).toBe(100 * GiB);
    expect(config.uploadTimeoutSeconds).toBe(3600);
    expect(existsSync(join(tmp, "config.json"))).toBe(false);
    const lock = join(tmp, "runtime.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), String(process.pid));
    await expect(
      main([
        "config",
        "set",
        "maxStorageBytes",
        String(50 * GiB),
        "--data-dir",
        tmp,
      ]),
    ).rejects.toThrow("Stop the running server");
    expect(store.getConfig().maxStorageBytes).toBe(100 * GiB);
    rmSync(lock, { recursive: true });
    await main([
      "config",
      "set",
      "maxStorageBytes",
      String(50 * GiB),
      "--data-dir",
      tmp,
    ]);
    expect(store.getConfig().maxStorageBytes).toBe(50 * GiB);
    await expect(
      main([
        "config",
        "set",
        "maxArtifactBytes",
        String(Number.MAX_SAFE_INTEGER),
        "--data-dir",
        tmp,
      ]),
    ).rejects.toThrow("maxArtifactBytes");
    await expect(
      main(["config", "set", "noSuchColumn", "1", "--data-dir", tmp]),
    ).rejects.toThrow("Unknown");
    expect(store.getConfig().maxArtifactBytes).toBe(GiB);
    store.setAccount({ username: "admin", passwordHash: "$2b$placeholder" });
    await expect(
      main(["user", "set", "another", "--password-stdin", "--data-dir", tmp]),
    ).rejects.toThrow("Only one administrator");
    expect(store.getAccount()?.username).toBe("admin");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("project HTTP management persists settings, protects mutations, and retains data on removal", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-project-api-"));
  const f = await fixture(tmp);
  const script = join(tmp, "deploy.sh");
  writeFileSync(script, "#!/bin/sh\nsleep 10\n");
  const input = {
    id: "docker",
    name: "Docker service",
    script,
    timeoutSeconds: 300,
  };
  let releaseDeploy = () => {};
  let pendingDeploy: Promise<Response> | undefined;
  try {
    expect(
      (
        await fetch(f.origin + "/api/projects", {
          method: "POST",
          headers: { Origin: f.origin, "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await f.call("/api/projects", "POST", input, {
          "X-CSRF-Token": "invalid",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.call("/api/projects", "POST", input, {
          Origin: "https://other.invalid",
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.call("/api/projects", "POST", { ...input, id: "../bad" }))
        .status,
    ).toBe(400);
    expect(
      (
        await f.call("/api/projects", "POST", {
          ...input,
          script: "/does-not-exist.sh",
        })
      ).status,
    ).toBe(400);
    expect((await f.call("/api/projects", "POST", input)).status).toBe(201);
    expect((await f.call("/api/projects", "POST", input)).status).toBe(409);
    const listing = await (await f.call("/api/projects")).json();
    expect(listing.limits).toEqual(defaultLimits);
    expect(listing.projects[0].script).toBe(script);
    expect(
      (await f.call("/api/projects/docker", "PUT", { ...input, id: "renamed" }))
        .status,
    ).toBe(400);
    expect(
      (
        await f.call("/api/projects/docker", "PUT", {
          ...input,
          name: "Updated",
          timeoutSeconds: 600,
        })
      ).status,
    ).toBe(200);
    expect(f.store.getProjects()[0].name).toBe("Updated");
    const upload = await fetch(f.origin + "/api/projects/docker/artifacts", {
      method: "POST",
      headers: f.headers,
      body: "test image",
    });
    expect(upload.status).toBe(201);
    const artifact = (await upload.json()).artifact;
    const artifactPath = join(
      f.dir,
      "projects/docker/artifacts",
      artifact.id + ".bin",
    );
    expect(
      (
        await f.call("/api/projects", "POST", {
          ...input,
          id: "unsafe",
          script: artifactPath,
        })
      ).status,
    ).toBe(400);
    const deployBody = JSON.stringify({
      artifactId: artifact.id,
      version: "v1",
    });
    const deployGate = new Promise<void>((resolve) => {
      releaseDeploy = resolve;
    });
    let started = false;
    pendingDeploy = fetch(f.origin + "/api/projects/docker/deploy", {
      method: "POST",
      headers: { ...f.headers, "Content-Type": "application/json" },
      body: new ReadableStream({
        async pull(controller) {
          if (started) {
            controller.close();
            return;
          }
          started = true;
          controller.enqueue(new TextEncoder().encode(deployBody.slice(0, 1)));
          await deployGate;
          controller.enqueue(new TextEncoder().encode(deployBody.slice(1)));
          controller.close();
        },
      }),
    });
    let preparing = false;
    for (let i = 0; i < 100; i++) {
      preparing = (await (await f.call("/api/projects")).json()).managementBusy;
      if (preparing) break;
      await Bun.sleep(10);
    }
    expect(preparing).toBe(true);
    expect((await f.call("/api/projects/docker", "DELETE")).status).toBe(409);
    releaseDeploy();
    const deploy = await pendingDeploy;
    expect(deploy.status).toBe(202);
    const deployment = (await deploy.json()).deployment;
    expect((await f.call("/api/projects/docker", "PUT", input)).status).toBe(
      409,
    );
    expect((await f.call("/api/projects/docker", "DELETE")).status).toBe(409);
    expect(
      (await f.call("/api/projects", "POST", { ...input, id: "another" }))
        .status,
    ).toBe(409);
    expect(
      (
        await f.call(
          `/api/projects/docker/deployments/${deployment.id}/cancel`,
          "POST",
        )
      ).status,
    ).toBe(200);
    for (let i = 0; i < 100; i++) {
      const result = await (
        await f.call(`/api/projects/docker/deployments/${deployment.id}`)
      ).json();
      if (result.deployment.status !== "running") break;
      await Bun.sleep(20);
    }
    expect((await f.call("/api/projects/docker", "DELETE")).status).toBe(200);
    expect(existsSync(artifactPath)).toBe(true);
    expect((await (await f.call("/api/projects")).json()).projects).toEqual([]);
    expect((await f.call("/api/projects", "POST", input)).status).toBe(201);
    const restored = (await (await f.call("/api/projects")).json()).projects[0];
    expect(restored.artifacts[0].id).toBe(artifact.id);
    expect(restored.deployments[0].status).toBe("cancelled");
    expect((await f.call("/api/projects/missing", "DELETE")).status).toBe(404);
    const persisted = f.store.getProjects();
    expect(persisted[0].id).toBe("docker");
    expect(persisted[0].timeoutSeconds).toBe(300);
  } finally {
    releaseDeploy();
    if (pendingDeploy) await pendingDeploy.catch(() => {});
    await f.runtime.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("large streamed uploads exceed the old limit and block project changes until complete", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-large-upload-"));
  const f = await fixture(tmp);
  const script = join(tmp, "deploy.sh");
  writeFileSync(script, "#!/bin/sh\nexit 0\n");
  const input = { id: "docker", name: "Docker", script, timeoutSeconds: 300 };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending: Promise<Response> | undefined;
  try {
    expect((await f.call("/api/projects", "POST", input)).status).toBe(201);
    const chunk = new Uint8Array(256 * 1024);
    const bytes = 128 * 1024 ** 2;
    let sent = 0;
    pending = fetch(f.origin + "/api/projects/docker/artifacts", {
      method: "POST",
      headers: { ...f.headers, "X-Artifact-Name": "docker-image.tar" },
      body: new ReadableStream({
        async pull(controller) {
          if (sent >= bytes) {
            controller.close();
            return;
          }
          controller.enqueue(chunk);
          sent += chunk.length;
          if (sent === chunk.length) await gate;
          await Bun.sleep(1);
        },
      }),
    });
    let uploading = false;
    for (let i = 0; i < 100; i++) {
      uploading = (await (await f.call("/api/projects")).json()).uploading;
      if (uploading) break;
      await Bun.sleep(10);
    }
    expect(uploading).toBe(true);
    expect((await f.call("/api/projects/docker", "PUT", input)).status).toBe(
      409,
    );
    expect((await f.call("/api/projects/docker", "DELETE")).status).toBe(409);
    release();
    const response = await pending;
    expect(response.status).toBe(201);
    expect((await response.json()).artifact.size).toBe(bytes);
    expect((await f.call("/api/projects/docker", "PUT", input)).status).toBe(
      200,
    );
  } finally {
    release();
    if (pending) await pending.catch(() => {});
    await f.runtime.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
}, 15000);
