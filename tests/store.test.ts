import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Store,
  storedArtifactBytes,
  type Deployment,
} from "../apps/server/src/store";

const project = {
  id: "demo",
  name: "Demo",
  script: "/bin/true",
  timeoutSeconds: 300,
};
const artifact = (id: string) => ({
  id,
  name: "release.tar",
  size: 7,
  createdAt: new Date().toISOString(),
});
const deployment = (id: string, artifactId: string): Deployment => ({
  id,
  artifactId,
  version: "v1",
  status: "running",
  startedAt: new Date().toISOString(),
});

test("SQLite survives reopen, retains archived projects, and recovers interrupted history and partial files", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-sqlite-"));
  let store = new Store(dir);
  try {
    store.setProject(project);
    store.setConfig({ ...store.getConfig(), port: 8765 });
    store.setAccount({ username: "admin", passwordHash: "$2b$fixture" });
    const base = join(dir, "projects/demo");
    writeFileSync(join(base, "artifacts/ready.bin"), "release");
    writeFileSync(join(base, "artifacts/partial.bin"), "partial upload");
    writeFileSync(join(base, "logs/running.log"), "started\n");
    writeFileSync(join(base, "logs/orphan.log"), "orphan");
    store.addArtifact(project.id, artifact("ready"));
    store.addArtifact(project.id, artifact("missing"));
    store.addDeployment(project.id, deployment("running", "ready"));
    store.removeProject(project.id);
    store.close();
    store = new Store(dir);
    // Opening for a CLI command must not rewrite running deployment history.
    expect(store.getState(project.id).deployments[0].status).toBe("running");
    expect(store.getProjects()).toEqual([]);
    expect(store.getConfig().port).toBe(8765);
    expect(store.getAccount()?.username).toBe("admin");
    store.recover();
    expect(store.getState(project.id).deployments[0].status).toBe(
      "interrupted",
    );
    expect(store.getState(project.id).deployments[0].finishedAt).toBeString();
    expect(store.getState(project.id).artifacts.map((a) => a.id)).toEqual([
      "ready",
    ]);
    expect(existsSync(join(base, "artifacts/partial.bin"))).toBe(false);
    expect(existsSync(join(base, "logs/orphan.log"))).toBe(false);
    expect(existsSync(join(base, "logs/running.log"))).toBe(true);
    expect(storedArtifactBytes(dir)).toBe(7);
    store.setProject(project);
    expect(store.getProjects()).toEqual([project]);
    expect(store.getState(project.id).deployments).toHaveLength(1);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
    expect(existsSync(join(base, "state.json"))).toBe(false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention removes matching files while preserving history of expired artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-retention-"));
  const store = new Store(dir);
  try {
    store.setProject(project);
    const base = join(dir, "projects/demo");
    for (const id of ["old", "new"]) {
      writeFileSync(join(base, "artifacts", id + ".bin"), "release");
      store.addArtifact(project.id, artifact(id));
    }
    const first = deployment("first", "old");
    first.status = "succeeded";
    first.finishedAt = new Date().toISOString();
    first.exitCode = 0;
    store.addDeployment(project.id, first);
    store.finishDeployment(project.id, first);
    writeFileSync(join(base, "logs/first.log"), "done");
    store.trim(project.id, { ...store.getConfig(), artifactRetention: 1 });
    expect(store.getState(project.id).artifacts.map((a) => a.id)).toEqual([
      "new",
    ]);
    expect(existsSync(join(base, "artifacts/old.bin"))).toBe(false);
    expect(store.getDeployment(project.id, "first")?.artifactId).toBe("old");
    expect(store.getDeployment(project.id, "first")?.exitCode).toBe(0);
    const second = deployment("second", "new");
    store.addDeployment(project.id, second);
    writeFileSync(join(base, "logs/second.log"), "running");
    store.trim(project.id, { ...store.getConfig(), historyRetention: 1 });
    expect(store.getDeployment(project.id, "first")).toBeUndefined();
    expect(existsSync(join(base, "logs/first.log"))).toBe(false);
    expect(existsSync(join(base, "logs/second.log"))).toBe(true);
    expect(storedArtifactBytes(dir)).toBe(7);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SQLite enforces one administrator and foreign keys, and failed writes leave no metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-constraints-"));
  const store = new Store(dir);
  try {
    store.setAccount({ username: "admin", passwordHash: "$2b$initial" });
    expect(() =>
      store.setAccount({ username: "other", passwordHash: "$2b$other" }),
    ).toThrow("Only one administrator");
    expect(store.getAccount()?.passwordHash).toBe("$2b$initial");
    expect(() =>
      store.addArtifact("missing-project", artifact("invalid")),
    ).toThrow();
    expect(store.getState("missing-project").artifacts).toEqual([]);
    const db = new Database(store.path);
    try {
      expect(() =>
        db
          .query("INSERT INTO administrator VALUES (2, ?, ?)")
          .run("other", "$2b$other"),
      ).toThrow();
      expect(db.query("PRAGMA journal_mode").get()).toEqual({
        journal_mode: "wal",
      });
    } finally {
      db.close();
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
