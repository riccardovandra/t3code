import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";

/** The subset of D1 the services use, backed by an in-memory node:sqlite database with the real migrations. */
export function makeTestD1(): D1Database {
  const sqlite = new NodeSqlite.DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../../../migrations/", import.meta.url);
  for (const file of NodeFS.readdirSync(migrations).toSorted()) {
    if (file.endsWith(".sql")) sqlite.exec(NodeFS.readFileSync(new URL(file, migrations), "utf8"));
  }

  const statement = (sql: string, params: Array<NodeSqlite.SQLInputValue> = []) => ({
    bind: (...values: Array<unknown>) => statement(sql, values as Array<NodeSqlite.SQLInputValue>),
    first: async () => (sqlite.prepare(sql).get(...params) as unknown) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params), success: true, meta: {} }),
    run: async () => {
      const prepared = sqlite.prepare(sql);
      // RETURNING statements must be stepped with all() to apply.
      if (/\breturning\b/i.test(sql)) {
        const rows = prepared.all(...params);
        return { results: [], success: true, meta: { changes: rows.length } };
      }
      const result = prepared.run(...params);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    },
  });

  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Array<ReturnType<typeof statement>>) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (cause) {
        sqlite.exec("ROLLBACK");
        throw cause;
      }
    },
  };
  return db as unknown as D1Database;
}
