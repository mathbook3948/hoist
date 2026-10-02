import { test, expect, spyOn } from "bun:test";
import * as fs from "node:fs";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  statSync,
  mkdirSync,
  symlinkSync,
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

test("SQLite survives reopen and recovers interrupted history and partial files", () => {
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
    store.close();
    store = new Store(dir);
    // Opening for a CLI command must not rewrite running deployment history.
    expect(store.getState(project.id).deployments[0].status).toBe("running");
    expect(store.getProjects()).toEqual([project]);
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
    if (process.platform !== "win32")
      expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
    expect(existsSync(join(base, "state.json"))).toBe(false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project deletion removes all managed files and metadata without touching other projects or external scripts", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-delete-"));
  const store = new Store(dir);
  try {
    const external = join(dir, "shared.sh");
    writeFileSync(external, "echo shared");
    store.setProject({ ...project, script: external });
    store.setProject({ ...project, id: "other", script: external });
    const base = join(store.dir, "projects", project.id);
    writeFileSync(join(base, "deploy.sh"), "echo managed");
    writeFileSync(join(base, "artifacts", "ready.bin"), "release");
    writeFileSync(join(base, "logs", "done.log"), "done");
    store.addArtifact(project.id, artifact("ready"));
    store.addDeployment(project.id, {
      ...deployment("done", "ready"),
      status: "succeeded",
    });
    const shared = join(dir, "shared");
    mkdirSync(shared);
    writeFileSync(join(shared, "keep.txt"), "keep");
    symlinkSync(
      shared,
      join(base, "shared-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(storedArtifactBytes(store.dir)).toBe(7);
    store.removeProject(project.id);
    expect(store.getProjects(true).map((p) => p.id)).toEqual(["other"]);
    expect(store.getState(project.id)).toEqual({
      artifacts: [],
      deployments: [],
    });
    expect(existsSync(base)).toBe(false);
    expect(existsSync(join(store.dir, "projects", "other"))).toBe(true);
    expect(existsSync(external)).toBe(true);
    expect(existsSync(join(shared, "keep.txt"))).toBe(true);
    expect(storedArtifactBytes(store.dir)).toBe(0);
    store.recover();
    expect(existsSync(base)).toBe(false);
    store.setProject(project);
    expect(store.getState(project.id)).toEqual({
      artifacts: [],
      deployments: [],
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed file deletion rolls back metadata and can be retried", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-delete-failed-"));
  const store = new Store(dir);
  let remove: ReturnType<typeof spyOn> | undefined;
  try {
    store.setProject(project);
    store.addArtifact(project.id, artifact("ready"));
    store.addDeployment(project.id, deployment("running", "ready"));
    remove = spyOn(fs, "rmSync").mockImplementation(() => {
      throw new Error("File locked");
    });
    expect(() => store.removeProject(project.id)).toThrow("File locked");
    expect(store.getProject(project.id)).toEqual(project);
    expect(store.getState(project.id).artifacts).toHaveLength(1);
    expect(store.getState(project.id).deployments).toHaveLength(1);
    remove.mockRestore();
    store.removeProject(project.id);
    expect(store.getProjects(true)).toEqual([]);
    expect(existsSync(join(store.dir, "projects", project.id))).toBe(false);
  } finally {
    remove?.mockRestore();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project deletion rejects path traversal and linked project directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-delete-path-"));
  const store = new Store(join(dir, "data"));
  try {
    store.setProject(project);
    expect(() => store.removeProject("../outside")).toThrow("Invalid project");
    const outside = join(dir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "keep");
    const base = join(store.dir, "projects", project.id);
    rmSync(base, { recursive: true });
    symlinkSync(
      outside,
      base,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => store.removeProject(project.id)).toThrow("real directory");
    expect(store.getProject(project.id)).toEqual(project);
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
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
