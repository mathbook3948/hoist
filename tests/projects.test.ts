import { test, expect } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, GiB, defaultLimits } from "../apps/server/src/store";
import { startServer } from "../apps/server/src/server";
import { main } from "../apps/cli/src/main";
import { createProjects } from "../apps/server/src/projects";
import { trustedScript } from "../apps/server/src/scripts";

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

test("managed scripts use generated IDs, load on demand, and persist edits through authenticated HTTP", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-managed-http-"));
  const f = await fixture(tmp);
  try {
    const created = await f.call("/api/projects", "POST", { name: "Managed" });
    expect(created.status).toBe(201);
    const { project } = await created.json();
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
    const scriptPath = join(f.dir, "projects", project.id, "deploy.sh");
    expect(project.script).toBe(scriptPath);
    expect(readFileSync(scriptPath, "utf8")).toContain("exit 1");
    const endpoint = `/api/projects/${project.id}`;
    expect((await fetch(f.origin + endpoint + "/script")).status).toBe(401);
    expect((await f.call(endpoint + "/script")).status).toBe(200);
    const listing = await (await f.call("/api/projects")).json();
    expect(listing.projects[0].scriptContent).toBeUndefined();
    const scriptContent = '#!/bin/sh\r\nset -eu\r\nprintf "%s\\n" "$2"\r\n';
    const input = { name: "Renamed", scriptContent, timeoutSeconds: 60 };
    expect(
      (await f.call(endpoint, "PUT", input, { "X-CSRF-Token": "wrong" }))
        .status,
    ).toBe(403);
    expect((await f.call(endpoint, "PUT", input)).status).toBe(200);
    expect(
      (await (await f.call(endpoint + "/script")).json()).scriptContent,
    ).toBe(scriptContent.replaceAll("\r\n", "\n"));
    expect(f.store.getProject(project.id)?.script).toBe(scriptPath);
    expect(f.store.getProject(project.id)?.name).toBe("Renamed");
    const before = readFileSync(scriptPath, "utf8");
    expect(
      (await f.call(endpoint, "PUT", { ...input, id: "changed" })).status,
    ).toBe(400);
    expect(
      (
        await f.call(endpoint, "PUT", {
          ...input,
          scriptContent: "x".repeat(65537),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.call(endpoint, "PUT", {
          ...input,
          scriptContent: "bad\u0000script",
        })
      ).status,
    ).toBe(400);
    expect(readFileSync(scriptPath, "utf8")).toBe(before);
    const second = await (
      await f.call("/api/projects", "POST", { name: "Renamed" })
    ).json();
    expect(second.project.id).not.toBe(project.id);
    expect((await f.call(endpoint, "DELETE")).status).toBe(200);
    expect(existsSync(scriptPath)).toBe(true);
    expect((await f.call(endpoint + "/script")).status).toBe(404);
  } finally {
    await f.runtime.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("script saves preserve previous files on busy or failed persistence and retain legacy paths", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-managed-save-"));
  const store = new Store(join(tmp, "data"));
  let busy = false;
  const projects = createProjects(store, join(tmp, "assets"), () => busy);
  try {
    const legacy = join(tmp, "legacy.sh");
    writeFileSync(legacy, "#!/bin/sh\necho legacy\n");
    const project = projects.create({ name: "Legacy", script: legacy });
    projects.update(project.id, {
      name: "Legacy",
      scriptContent: "#!/bin/sh\necho updated\n",
    });
    expect(store.getProject(project.id)?.script).toBe(legacy);
    expect(readFileSync(legacy, "utf8")).toContain("echo updated");
    const managed = projects.create({ name: "Managed" });
    const before = readFileSync(managed.script, "utf8");
    busy = true;
    expect(() =>
      projects.update(managed.id, { name: "Busy", scriptContent: "echo busy" }),
    ).toThrow("finish");
    busy = false;
    const save = store.setProject.bind(store);
    store.setProject = () => {
      throw new Error("Database failure");
    };
    expect(() =>
      projects.update(managed.id, {
        name: "Failed",
        scriptContent: "echo failed",
      }),
    ).toThrow("Database failure");
    store.setProject = save;
    expect(readFileSync(managed.script, "utf8")).toBe(before);
    expect(store.getProject(managed.id)?.name).toBe("Managed");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("managed scripts cannot use artifact paths, other project scripts or linked directories", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-managed-path-"));
  const store = new Store(join(tmp, "data"));
  const assets = join(tmp, "assets");
  const projects = createProjects(store, assets, () => false);
  try {
    const a = projects.create({ name: "A" });
    const b = projects.create({ name: "B" });
    expect(trustedScript(store.dir, assets, a.id, a.script)).toBe(a.script);
    expect(() => trustedScript(store.dir, assets, b.id, a.script)).toThrow(
      "Only this project",
    );
    const artifact = join(
      store.dir,
      "projects",
      a.id,
      "artifacts",
      "upload.bin",
    );
    writeFileSync(artifact, "echo unsafe");
    expect(() =>
      projects.update(a.id, { name: "A", script: artifact }),
    ).toThrow();
    const outside = join(tmp, "outside");
    mkdirSync(outside);
    symlinkSync(
      outside,
      join(store.dir, "projects", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => projects.create({ id: "linked", name: "Linked" })).toThrow(
      "real directory",
    );
    expect(existsSync(join(outside, "deploy.sh"))).toBe(false);
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "linux")(
  "a managed deploy.sh executes with artifact and version arguments",
  async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hoist-managed-run-"));
    const f = await fixture(tmp);
    try {
      const { project } = await (
        await f.call("/api/projects", "POST", {
          name: "Shell",
          scriptContent:
            '#!/bin/sh\nset -eu\nprintf "version=%s\\n" "$2"\ncat "$1"\n',
        })
      ).json();
      const endpoint = `/api/projects/${project.id}`;
      const upload = await fetch(f.origin + endpoint + "/artifacts", {
        method: "POST",
        headers: f.headers,
        body: "managed artifact",
      });
      const { artifact } = await upload.json();
      const launched = await f.call(endpoint + "/deploy", "POST", {
        artifactId: artifact.id,
        version: "v-managed",
      });
      expect(launched.status).toBe(202);
      const { deployment } = await launched.json();
      let result;
      for (let i = 0; i < 100; i++) {
        result = await (
          await f.call(endpoint + `/deployments/${deployment.id}`)
        ).json();
        if (result.deployment.status !== "running") break;
        await Bun.sleep(20);
      }
      expect(result.deployment.status).toBe("succeeded");
      expect(result.log).toContain("version=v-managed");
      expect(result.log).toContain("managed artifact");
    } finally {
      await f.runtime.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  },
);

test("CLI project create generates an ID and imports the initial script", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-cli-project-"));
  try {
    const input = join(tmp, "source.sh");
    writeFileSync(input, "#!/bin/sh\r\necho cli\r\n");
    const data = join(tmp, "data");
    await main([
      "project",
      "create",
      "CLI project",
      "--script",
      input,
      "--data-dir",
      data,
    ]);
    const store = new Store(data);
    try {
      const [project] = store.getProjects();
      expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(project.name).toBe("CLI project");
      expect(project.script).toBe(
        join(store.dir, "projects", project.id, "deploy.sh"),
      );
      expect(readFileSync(project.script, "utf8")).toBe(
        "#!/bin/sh\necho cli\n",
      );
    } finally {
      store.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
