import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "vite-plus/test";

const migrations = new URL("../../migrations/", import.meta.url);
const files = NodeFS.readdirSync(migrations)
  .filter((file) => file.endsWith(".sql"))
  .toSorted();
const apply = (sqlite: NodeSqlite.DatabaseSync, file: string) =>
  sqlite.exec(NodeFS.readFileSync(new URL(file, migrations), "utf8"));

describe("0005_project_keys", () => {
  it("keys existing projects and rebuilds docs without losing what hangs off them", () => {
    const sqlite = new NodeSqlite.DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    const index = files.indexOf("0005_project_keys.sql");
    for (const file of files.slice(0, index)) apply(sqlite, file);
    sqlite.exec(`
      INSERT INTO projects VALUES ('p1', ' Client Work ', 1), ('p2', 'client work', 2);
      INSERT INTO docs VALUES ('d1', 'p1', 'Plan', 'plan', 1, 1);
      INSERT INTO tabs VALUES ('t1', 'd1', NULL, 0, 'Plan', '# Plan', 3, 1);
      INSERT INTO tabs VALUES ('t2', 'd1', 't1', 0, 'Child', '', 1, 1);
      INSERT INTO comments VALUES ('c1', 'd1', 't1', NULL, 'Plan', '', '', 'Why?', 'a', NULL, 1, 1);
      INSERT INTO comments VALUES ('c2', 'd1', 't1', 'c1', '', '', '', 'Because', 'b', NULL, 2, 2);
      INSERT INTO doc_threads VALUES ('l1', 'd1', 'env', 'thread', 'Work', 1);
    `);
    apply(sqlite, "0005_project_keys.sql");

    const count = (table: string) =>
      (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect([count("docs"), count("tabs"), count("comments"), count("doc_threads")]).toEqual([
      1, 2, 2, 1,
    ]);
    expect(sqlite.prepare("SELECT id, key FROM projects ORDER BY id").all()).toEqual([
      { id: "p1", key: "title:client work" },
      { id: "p2", key: "title:client work:p2" },
    ]);
    sqlite.exec("INSERT INTO docs VALUES ('d2', NULL, 'Loose', 'thinking', 1, 1)");
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    // The children still cascade from the rebuilt table.
    sqlite.exec("DELETE FROM docs WHERE id = 'd1'");
    expect([count("tabs"), count("comments"), count("doc_threads")]).toEqual([0, 0, 0]);
  });
});
