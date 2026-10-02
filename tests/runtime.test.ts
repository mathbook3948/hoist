import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initData, loadState, type Project } from "../src/store";
import { createArtifacts } from "../src/artifacts";
import { createDeployments } from "../src/deployments";

function fixture(dir: string, script: string) {
  const { config } = initData(dir);
  const projects: Project[] = ["first", "second"].map((id) => ({
    id,
    name: id,
    script,
    timeoutSeconds: 10,
  }));
  const states = projects.map((p) => loadState(dir, p));
  const deployments = createDeployments(
    dir,
    config,
    join(import.meta.dir, "../public"),
  );
  const artifacts = createArtifacts(dir, config, deployments.isRunning);
  return { projects, states, deployments, artifacts };
}

const uploadRequest = (body: BodyInit) =>
  new Request("http://127.0.0.1/artifacts", { method: "POST", body });

test("upload capacity is shared across projects and isolated between server instances", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-upload-slots-"));
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const first = fixture(join(tmp, "one"), "/unused.sh");
  const second = fixture(join(tmp, "two"), "/unused.sh");
  const pending = first.artifacts.upload(
    uploadRequest(body),
    first.projects[0],
    first.states[0],
  );
  let completed = false;
  try {
    await expect(
      first.artifacts.upload(
        uploadRequest("blocked"),
        first.projects[1],
        first.states[1],
      ),
    ).rejects.toThrow("Upload/deployment busy");
    const independent = await second.artifacts.upload(
      uploadRequest("independent"),
      second.projects[0],
      second.states[0],
    );
    expect(independent.size).toBe(11);
    controller.enqueue(new TextEncoder().encode("first"));
    controller.close();
    expect((await pending).size).toBe(5);
    completed = true;
    const next = await first.artifacts.upload(
      uploadRequest("next"),
      first.projects[1],
      first.states[1],
    );
    expect(next.size).toBe(4);
  } finally {
    if (!completed) {
      try {
        controller.error(new Error("Test cleanup"));
      } catch {}
      await pending.catch(() => {});
    }
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deployment capacity is shared across projects and isolated between server instances", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "hoist-deploy-slots-"));
  const script = join(tmp, "wait.sh");
  writeFileSync(script, "#!/bin/sh\nsleep 1\n");
  const first = fixture(join(tmp, "one"), script);
  const second = fixture(join(tmp, "two"), script);
  try {
    const artifact = await first.artifacts.upload(
      uploadRequest("artifact"),
      first.projects[0],
      first.states[0],
    );
    const otherArtifact = await second.artifacts.upload(
      uploadRequest("artifact"),
      second.projects[0],
      second.states[0],
    );
    const deployment = first.deployments.launch(
      first.projects[0],
      first.states[0],
      artifact.id,
      "v1",
    );
    expect(() =>
      first.deployments.launch(
        first.projects[1],
        first.states[1],
        artifact.id,
        "v1",
      ),
    ).toThrow("already running");
    await expect(
      first.artifacts.upload(
        uploadRequest("blocked"),
        first.projects[0],
        first.states[0],
      ),
    ).rejects.toThrow("Upload/deployment busy");
    const independent = second.deployments.launch(
      second.projects[0],
      second.states[0],
      otherArtifact.id,
      "v1",
    );
    first.deployments.cancelAll();
    second.deployments.cancelAll();
    await Promise.all([
      first.deployments.waitForIdle(),
      second.deployments.waitForIdle(),
    ]);
    expect(deployment.status).toBe("cancelled");
    expect(independent.status).toBe("cancelled");
    const next = first.deployments.launch(
      first.projects[0],
      first.states[0],
      artifact.id,
      "v2",
    );
    first.deployments.cancelAll();
    await first.deployments.waitForIdle();
    expect(next.status).toBe("cancelled");
  } finally {
    first.deployments.cancelAll();
    second.deployments.cancelAll();
    await Promise.all([
      first.deployments.waitForIdle(),
      second.deployments.waitForIdle(),
    ]);
    rmSync(tmp, { recursive: true, force: true });
  }
});
