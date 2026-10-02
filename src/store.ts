import { Database } from "bun:sqlite";
import {
  mkdirSync,
  existsSync,
  chmodSync,
  lstatSync,
  readdirSync,
  unlinkSync,
  realpathSync,
  openSync,
  closeSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { schema } from "./schema";
import {
  type Account,
  type Project,
  type Config,
  type Artifact,
  type Deployment,
  type State,
  validId,
  defaultConfig,
  validateConfig,
} from "./models";
export * from "./models";

export function initData(input: string) {
  let dir = resolve(input);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink())
    throw new Error("Data directory must not be a symlink");
  dir = realpathSync(dir);
  chmodSync(dir, 0o700);
  mkdirSync(join(dir, "projects"), { mode: 0o700, recursive: true });
  return { dir };
}
export function projectDir(dir: string, id: string) {
  if (!validId(id)) throw new Error("Invalid project");
  return join(dir, "projects", id);
}
export function prepareProject(dir: string, id: string) {
  for (const folder of ["artifacts", "logs"])
    mkdirSync(join(projectDir(dir, id), folder), {
      mode: 0o700,
      recursive: true,
    });
}

type DeploymentRow = Omit<Deployment, "finishedAt" | "exitCode"> & {
  finishedAt: string | null;
  exitCode: number | null;
};
function deploymentFromRow({
  finishedAt,
  exitCode,
  ...d
}: DeploymentRow): Deployment {
  return finishedAt === null ? d : { ...d, finishedAt, exitCode };
}

export class Store {
  readonly dir: string;
  readonly path: string;
  private db: Database;
  private closed = false;
  constructor(input: string) {
    this.dir = initData(input).dir;
    this.path = join(this.dir, "hoist.sqlite");
    if (!existsSync(this.path)) closeSync(openSync(this.path, "wx", 0o600));
    if (!lstatSync(this.path).isFile())
      throw new Error("Database must be a regular file");
    chmodSync(this.path, 0o600);
    this.db = new Database(this.path, { strict: true });
    try {
      this.db.exec(
        "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
      );
      this.db.transaction(() => {
        this.db.exec(schema);
        this.db
          .query(
            `INSERT OR IGNORE INTO settings VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            defaultConfig.host,
            defaultConfig.port,
            defaultConfig.publicOrigin,
            defaultConfig.maxArtifactBytes,
            defaultConfig.maxStorageBytes,
            defaultConfig.uploadTimeoutSeconds,
            defaultConfig.artifactRetention,
            defaultConfig.historyRetention,
            defaultConfig.maxLogBytes,
            defaultConfig.sessionHours,
          );
      })();
      this.getConfig();
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
  getConfig(): Config {
    const { id, ...config } = this.db
      .query("SELECT * FROM settings WHERE id = 1")
      .get() as Config & { id: number };
    validateConfig(config);
    return config;
  }
  setConfig(config: Config) {
    validateConfig(config);
    this.db
      .query(
        `UPDATE settings SET host=?, port=?, publicOrigin=?, maxArtifactBytes=?, maxStorageBytes=?,
      uploadTimeoutSeconds=?, artifactRetention=?, historyRetention=?, maxLogBytes=?, sessionHours=? WHERE id=1`,
      )
      .run(
        config.host,
        config.port,
        config.publicOrigin,
        config.maxArtifactBytes,
        config.maxStorageBytes,
        config.uploadTimeoutSeconds,
        config.artifactRetention,
        config.historyRetention,
        config.maxLogBytes,
        config.sessionHours,
      );
  }
  getAccount(): Account | null {
    return this.db
      .query("SELECT username, passwordHash FROM administrator WHERE id=1")
      .get() as Account | null;
  }
  setAccount(account: Account) {
    if (!validId(account.username) || !/^\$2[aby]\$/.test(account.passwordHash))
      throw new Error("Invalid account");
    this.db.transaction(() => {
      const old = this.getAccount();
      if (old && old.username !== account.username)
        throw new Error("Only one administrator account is supported");
      this.db
        .query(
          "INSERT INTO administrator VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET passwordHash=excluded.passwordHash",
        )
        .run(account.username, account.passwordHash);
    })();
  }
  removeAccount(username: string) {
    this.db.query("DELETE FROM administrator WHERE username=?").run(username);
  }
  getProjects(includeArchived = false): Project[] {
    return this.db
      .query(
        `SELECT id, name, script, timeoutSeconds FROM projects ${includeArchived ? "" : "WHERE archived=0"} ORDER BY rowid`,
      )
      .all() as Project[];
  }
  getProject(id: string): Project | null {
    return this.db
      .query(
        "SELECT id, name, script, timeoutSeconds FROM projects WHERE id=? AND archived=0",
      )
      .get(id) as Project | null;
  }
  setProject(p: Project) {
    if (!validId(p.id)) throw new Error("Invalid project");
    prepareProject(this.dir, p.id);
    this.db.transaction(() => {
      if (!this.getProject(p.id) && this.getProjects().length >= 32)
        throw new Error("Project limit reached");
      this.db
        .query(
          `INSERT INTO projects VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, script=excluded.script, timeoutSeconds=excluded.timeoutSeconds, archived=0`,
        )
        .run(p.id, p.name, p.script, p.timeoutSeconds);
    })();
  }
  removeProject(id: string) {
    this.db.query("UPDATE projects SET archived=1 WHERE id=?").run(id);
  }
  getState(projectId: string): State {
    return {
      artifacts: this.db
        .query(
          "SELECT id, name, size, createdAt FROM artifacts WHERE projectId=? ORDER BY rowid",
        )
        .all(projectId) as Artifact[],
      deployments: (
        this.db
          .query(
            "SELECT id, artifactId, version, status, startedAt, finishedAt, exitCode FROM deployments WHERE projectId=? ORDER BY rowid",
          )
          .all(projectId) as DeploymentRow[]
      ).map(deploymentFromRow),
    };
  }
  getArtifact(projectId: string, id: string): Artifact | null {
    return this.db
      .query(
        "SELECT id, name, size, createdAt FROM artifacts WHERE projectId=? AND id=?",
      )
      .get(projectId, id) as Artifact | null;
  }
  addArtifact(projectId: string, a: Artifact) {
    this.db
      .query("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?)")
      .run(a.id, projectId, a.name, a.size, a.createdAt);
  }
  getDeployment(projectId: string, id: string): Deployment | undefined {
    const row = this.db
      .query(
        "SELECT id, artifactId, version, status, startedAt, finishedAt, exitCode FROM deployments WHERE projectId=? AND id=?",
      )
      .get(projectId, id) as DeploymentRow | null;
    return row ? deploymentFromRow(row) : undefined;
  }
  addDeployment(projectId: string, d: Deployment) {
    this.db
      .query("INSERT INTO deployments VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)")
      .run(d.id, projectId, d.artifactId, d.version, d.status, d.startedAt);
  }
  finishDeployment(projectId: string, d: Deployment) {
    this.db
      .query(
        "UPDATE deployments SET status=?, finishedAt=?, exitCode=? WHERE projectId=? AND id=?",
      )
      .run(d.status, d.finishedAt ?? null, d.exitCode ?? null, projectId, d.id);
  }
  trim(projectId: string, config: Config) {
    const s = this.getState(projectId);
    const artifacts = s.artifacts.slice(
      0,
      Math.max(0, s.artifacts.length - config.artifactRetention),
    );
    const deployments = s.deployments.slice(
      0,
      Math.max(0, s.deployments.length - config.historyRetention),
    );
    // Commit metadata first. Leftover files are safe to clean on startup after a crash.
    this.db.transaction(() => {
      for (const a of artifacts)
        this.db.query("DELETE FROM artifacts WHERE id=?").run(a.id);
      for (const d of deployments)
        this.db.query("DELETE FROM deployments WHERE id=?").run(d.id);
    })();
    for (const a of artifacts)
      this.removeFile(projectId, "artifacts", a.id + ".bin");
    for (const d of deployments)
      this.removeFile(projectId, "logs", d.id + ".log");
  }
  private removeFile(projectId: string, folder: string, name: string) {
    const path = join(projectDir(this.dir, projectId), folder, name);
    if (existsSync(path)) unlinkSync(path);
  }
  recover() {
    this.db
      .query(
        "UPDATE deployments SET status='interrupted', finishedAt=? WHERE status='running'",
      )
      .run(new Date().toISOString());
    for (const p of this.getProjects(true)) {
      prepareProject(this.dir, p.id);
      const state = this.getState(p.id);
      for (const [folder, names] of [
        ["artifacts", new Set(state.artifacts.map((a) => a.id + ".bin"))],
        ["logs", new Set(state.deployments.map((d) => d.id + ".log"))],
      ] as const)
        for (const file of readdirSync(
          join(projectDir(this.dir, p.id), folder),
        ))
          if (!names.has(file)) this.removeFile(p.id, folder, file);
      // Missing artifacts cannot be deployed; preserve deployment history.
      for (const a of state.artifacts)
        if (
          !existsSync(
            join(projectDir(this.dir, p.id), "artifacts", a.id + ".bin"),
          )
        )
          this.db.query("DELETE FROM artifacts WHERE id=?").run(a.id);
    }
  }
}

// Count actual disk use, including archived project files and an in-progress upload.
export function storedArtifactBytes(dir: string) {
  let size = 0;
  const folders = readdirSync(join(dir, "projects"));
  if (folders.length > 1024)
    throw new Error(
      "Too many retained project directories; clean data offline",
    );
  for (const folder of folders) {
    if (!validId(folder)) throw new Error("Unexpected project directory");
    const base = join(dir, "projects", folder);
    if (!lstatSync(base).isDirectory())
      throw new Error("Unexpected project directory");
    const artifacts = join(base, "artifacts");
    if (!existsSync(artifacts)) continue;
    const files = readdirSync(artifacts);
    if (files.length > 101) throw new Error("Too many retained artifacts");
    for (const file of files) {
      const stat = lstatSync(join(artifacts, file));
      if (!stat.isFile()) throw new Error("Unexpected artifact file");
      size += stat.size;
    }
  }
  return size;
}
