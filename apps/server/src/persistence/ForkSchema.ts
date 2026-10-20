import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Tables owned by this fork live outside upstream's numbered migrations.
 *
 * The migrator skips every id up to the highest recorded one, so a fork
 * migration either takes an id upstream later uses or, numbered past upstream,
 * makes every later upstream migration skip. Idempotent DDL after upstream's
 * migrations avoids both.
 */

/** Migration-history rows earlier fork builds recorded under upstream's ids. */
const FORK_RECORDED_MIGRATIONS = [[65, "DocComments"]] as const;

/** Frees upstream ids that an earlier fork build recorded for its own tables. */
export const releaseForkMigrationIds = Effect.fn("releaseForkMigrationIds")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;
  for (const [id, name] of FORK_RECORDED_MIGRATIONS) {
    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${id} AND name = ${name}`;
  }
});

export const ensureForkSchema = Effect.fn("ensureForkSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Replies share the table with a parent_id so a thread is one indexed lookup;
  // quote/prefix/suffix only carry meaning on root comments.
  yield* sql`
    CREATE TABLE IF NOT EXISTS doc_comments (
      comment_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      doc_path TEXT NOT NULL,
      parent_id TEXT,
      author_kind TEXT NOT NULL,
      author_thread_id TEXT,
      body TEXT NOT NULL,
      quote TEXT NOT NULL DEFAULT '',
      prefix TEXT NOT NULL DEFAULT '',
      suffix TEXT NOT NULL DEFAULT '',
      resolved_at TEXT,
      sent_to_thread_id TEXT,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_doc_comments_project_doc_created
    ON doc_comments (project_id, doc_path, created_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_doc_comments_parent
    ON doc_comments (parent_id)
  `;
  // One doc agent subagent per (conversation thread, doc) receives that doc's
  // comments, so doc work stays out of the conversation itself.
  yield* sql`
    CREATE TABLE IF NOT EXISTS doc_agent_threads (
      parent_thread_id TEXT NOT NULL,
      doc_path TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (parent_thread_id, doc_path)
    ) WITHOUT ROWID
  `;
});
