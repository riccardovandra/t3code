import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { ensureForkSchema } from "./ForkSchema.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

describe("ForkSchema", () => {
  it.effect("creates the fork's tables on a fresh database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      assert.deepStrictEqual(yield* history, migrationManifest);
      yield* sql`SELECT comment_id FROM doc_comments`;
      yield* sql`SELECT thread_id FROM doc_agent_threads`;
      yield* sql`SELECT doc_id FROM docs_cloud_imports`;
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("runs upstream's migrations on a database that recorded DocComments as 65", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 64 });
      yield* ensureForkSchema();
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (65, 'DocComments')`;
      yield* sql`
        INSERT INTO doc_comments (comment_id, project_id, doc_path, author_kind, body, created_at)
        VALUES ('comment-1', 'project-1', 'docs/plan.md', 'user', 'Keep this', '2026-10-20T00:00:00Z')
      `;

      const executed = yield* runMigrations();

      assert.deepStrictEqual(
        executed,
        migrationManifest.filter(([id]) => id >= 65),
      );
      assert.deepStrictEqual(yield* history, migrationManifest);
      const comments = yield* sql<{ readonly body: string }>`SELECT body FROM doc_comments`;
      assert.deepStrictEqual(
        comments.map((row) => row.body),
        ["Keep this"],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
