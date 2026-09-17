import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
export class Store {
  db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS migrations(version TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
    );
    const directory = new URL("./migrations/", import.meta.url);
    for (const version of readdirSync(directory)
      .filter((v) => v.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(new URL(version, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const old = this.db
        .prepare("SELECT checksum FROM migrations WHERE version=?")
        .get(version);
      if (old && old.checksum !== checksum)
        throw new Error("MIGRATION_CHANGED:" + version);
      if (!old)
        this.transaction(() => {
          this.db.exec(sql);
          this.db
            .prepare("INSERT INTO migrations VALUES (?,?)")
            .run(version, checksum);
        });
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
