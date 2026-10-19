import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
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
