import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import initialSchema from "./001-initial.sql" with { type: "text" };

export type Migration = { id: number; name: string; sql: string };
export const migrations: readonly Migration[] = [
  { id: 1, name: "initial", sql: initialSchema },
];

/** Apply a complete pending batch atomically; never rewrite an applied migration. */
export function migrate(
  db: Database,
  definitions: readonly Migration[] = migrations,
) {
  const prepared = definitions.map((migration, index) => {
    // Match JavaScript template literal normalization across checkout platforms.
    const sql = migration.sql.replace(/\r\n?/g, "\n");
    if (migration.id !== index + 1 || !migration.name || !sql.trim()) {
      throw new Error("Migrations must have consecutive IDs starting at 1");
    }
    return {
      ...migration,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  });
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      appliedAt TEXT NOT NULL
    ) STRICT`);
    const applied = db
      .query("SELECT id, name, checksum FROM schema_migrations ORDER BY id")
      .all() as {
      id: number;
      name: string;
      checksum: string;
    }[];
    for (const [index, row] of applied.entries()) {
      const expected = prepared[index];
      if (!expected || row.id !== expected.id) {
        throw new Error(
          "Database migration history is newer than or incompatible with this Hoist executable",
        );
      }
      if (row.name !== expected.name || row.checksum !== expected.checksum) {
        throw new Error(
          `Applied migration ${row.id} has changed; restore the original migration`,
        );
      }
    }
    for (const migration of prepared.slice(applied.length)) {
      db.exec(migration.sql);
      db.query(
        "INSERT INTO schema_migrations (id, name, checksum, appliedAt) VALUES (?, ?, ?, ?)",
      ).run(
        migration.id,
        migration.name,
        migration.checksum,
        new Date().toISOString(),
      );
    }
  }).immediate();
}
