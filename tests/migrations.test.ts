import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, migrations } from "../apps/server/src/migrations";
import initialSchema from "../apps/server/src/migrations/001-initial.sql" with { type: "text" };
import { Store } from "../apps/server/src/store";
import { serve } from "../apps/server/src/runtime";

test("SQL files preserve the original migration checksum across checkout line endings", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    expect(
      db.query("SELECT checksum FROM schema_migrations WHERE id=1").get(),
    ).toEqual({
      checksum:
        "4d770a2f31aec5cff6dcf402fada8322cfc9f9ae170cff6033acca75c1642a22",
    });
    const before = db.query("SELECT * FROM schema_migrations").all();
    migrate(
      db,
      migrations.map((migration) => ({
        ...migration,
        sql: migration.sql.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"),
      })),
    );
    expect(db.query("SELECT * FROM schema_migrations").all()).toEqual(before);
  } finally {
    db.close();
  }
});

test("a migration validation failure prevents server startup and releases the CLI lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-migration-start-"));
  try {
    new Store(dir).close();
    const db = new Database(join(dir, "hoist.sqlite"));
    db.exec("UPDATE schema_migrations SET checksum='changed' WHERE id=1");
    db.close();
    expect(() => serve(dir)).toThrow("has changed");
    expect(existsSync(join(dir, "runtime.lock"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Store automatically initializes migration history and reopening is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-migration-"));
  try {
    const first = new Store(dir);
    first.setConfig({ ...first.getConfig(), port: 3999 });
    first.close();
    const before = new Database(join(dir, "hoist.sqlite"));
    const history = before.query("SELECT * FROM schema_migrations").all();
    before.close();
    const second = new Store(dir);
    expect(second.getConfig().port).toBe(3999);
    second.close();
    const after = new Database(join(dir, "hoist.sqlite"));
    expect(after.query("SELECT * FROM schema_migrations").all()).toEqual(
      history,
    );
    expect(history).toHaveLength(1);
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adopts an existing database without losing account, settings, project or deployment data", () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-legacy-"));
  try {
    const db = new Database(join(dir, "hoist.sqlite"));
    db.exec(initialSchema);
    db.exec(
      "INSERT INTO settings VALUES (1,'127.0.0.1',3988,NULL,1073741824,107374182400,3600,5,30,65536,8)",
    );
    db.exec("INSERT INTO administrator VALUES (1,'admin','$2b$fixture')");
    db.exec(
      "INSERT INTO projects VALUES ('demo','Existing','/trusted/deploy.sh',300,0)",
    );
    db.exec(
      "INSERT INTO deployments VALUES ('d1','demo','old-artifact','v1','succeeded','2026-01-01','2026-01-01',0)",
    );
    db.close();
    const store = new Store(dir);
    expect(store.getConfig().port).toBe(3988);
    expect(store.getAccount()?.username).toBe("admin");
    expect(store.getProject("demo")?.name).toBe("Existing");
    expect(store.getState("demo").deployments[0].version).toBe("v1");
    store.close();
    const check = new Database(join(dir, "hoist.sqlite"));
    expect(check.query("SELECT id FROM schema_migrations").all()).toEqual([
      { id: 1 },
    ]);
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pending schema changes apply once in order and a failed batch rolls back schema and history", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    const next = {
      id: 2,
      name: "add_notes",
      sql: "ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT '';",
    };
    const failing = {
      id: 3,
      name: "broken",
      sql: "CREATE TABLE partial (id INTEGER); INSERT INTO missing_table VALUES (1);",
    };
    expect(() => migrate(db, [...migrations, next, failing])).toThrow();
    expect(db.query("SELECT id FROM schema_migrations").all()).toEqual([
      { id: 1 },
    ]);
    expect(
      db
        .query("PRAGMA table_info(projects)")
        .all()
        .some((row: any) => row.name === "notes"),
    ).toBe(false);
    expect(
      db.query("SELECT name FROM sqlite_master WHERE name='partial'").get(),
    ).toBeNull();
    migrate(db, [...migrations, next]);
    migrate(db, [...migrations, next]);
    expect(
      db.query("SELECT id FROM schema_migrations ORDER BY id").all(),
    ).toEqual([{ id: 1 }, { id: 2 }]);
    expect(
      db
        .query("PRAGMA table_info(projects)")
        .all()
        .some((row: any) => row.name === "notes"),
    ).toBe(true);
    expect(() => migrate(db)).toThrow("newer than");
  } finally {
    db.close();
  }
});

test("changed migrations and invalid sequence are rejected before modifying existing data", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    expect(() =>
      migrate(db, [
        { ...migrations[0], sql: migrations[0].sql + "\n-- changed" },
      ]),
    ).toThrow("has changed");
    expect(() =>
      migrate(db, [{ id: 2, name: "gap", sql: "SELECT 1" }]),
    ).toThrow("consecutive");
    expect(db.query("SELECT id FROM schema_migrations").all()).toEqual([
      { id: 1 },
    ]);
  } finally {
    db.close();
  }
});
