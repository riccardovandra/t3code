// What the home page needs beyond the scoped library: card previews, member
// counts, the caller's last opens, and search over tab Markdown. Every query
// joins the caller's own doc_members row, so it only reaches docs they are on.

import type { AccessibleLibrary, LibraryDoc } from "../shared/access.ts";
import {
  docPreview,
  PREVIEW_SOURCE_LENGTH,
  SEARCH_LIMIT,
  searchSnippet,
  type HomeDoc,
  type HomeLibrary,
  type SearchHit,
} from "../shared/home.ts";

interface CardRow {
  doc_id: string;
  head: string | null;
  members: number;
  opened_at: number | null;
}

/** Adds each doc's preview, member count and the caller's last open to their library. */
export async function homeLibrary(
  db: D1Database,
  library: AccessibleLibrary,
  userId: string,
): Promise<HomeLibrary> {
  // Only the start of the first top-level tab leaves D1, so a large doc costs
  // the grid no more than a short one.
  const { results } = await db
    .prepare(
      `SELECT me.doc_id,
         (SELECT substr(t.markdown, 1, ?) FROM tabs t
          WHERE t.doc_id = me.doc_id AND t.parent_tab_id IS NULL
          ORDER BY t.position LIMIT 1) AS head,
         (SELECT count(*) FROM doc_members m WHERE m.doc_id = me.doc_id) AS members,
         o.opened_at
       FROM doc_members me
       LEFT JOIN doc_opens o ON o.doc_id = me.doc_id AND o.user_id = me.user_id
       WHERE me.user_id = ?`,
    )
    .bind(PREVIEW_SOURCE_LENGTH, userId)
    .all<CardRow>();
  const cards = new Map(results.map((row) => [row.doc_id, row]));
  const withCard = (docs: ReadonlyArray<LibraryDoc>): ReadonlyArray<HomeDoc> =>
    docs.map((doc) => {
      const card = cards.get(doc.id);
      return {
        ...doc,
        preview: card?.head ? docPreview(card.head, doc.title) : "",
        memberCount: card?.members ?? 1,
        openedAt: card?.opened_at ?? null,
      };
    });
  return {
    projects: library.projects.map((project) => ({ ...project, docs: withCard(project.docs) })),
    noProjectDocs: withCard(library.noProjectDocs),
  };
}

/** Records that a person opened a doc; agent tokens never call this. */
export async function recordOpen(
  db: D1Database,
  input: { readonly docId: string; readonly userId: string; readonly now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO doc_opens (doc_id, user_id, opened_at) VALUES (?, ?, ?)
       ON CONFLICT (doc_id, user_id) DO UPDATE SET opened_at = excluded.opened_at`,
    )
    .bind(input.docId, input.userId, input.now)
    .run();
}

const SNIPPET_WINDOW_BEFORE = 300;
const SNIPPET_WINDOW = 800;

const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

interface SearchRow {
  doc_id: string;
  tab_id: string;
  tab_title: string;
  window_start: number;
  window_text: string;
  total: number;
}

/**
 * Tabs whose Markdown contains `query` (ASCII case-insensitive, like SQLite's
 * LIKE), in docs the user is on, most recently edited first.
 */
export async function searchTabs(
  db: D1Database,
  input: { readonly userId: string; readonly query: string },
): Promise<ReadonlyArray<SearchHit>> {
  const { results } = await db
    .prepare(
      `SELECT t.doc_id, t.id AS tab_id, t.title AS tab_title,
         max(1, instr(lower(t.markdown), lower(?1)) - ?2) AS window_start,
         substr(t.markdown, max(1, instr(lower(t.markdown), lower(?1)) - ?2), ?3) AS window_text,
         length(t.markdown) AS total
       FROM tabs t
       JOIN doc_members me ON me.doc_id = t.doc_id AND me.user_id = ?4
       WHERE t.markdown LIKE ?5 ESCAPE '\\'
       ORDER BY t.updated_at DESC, t.id
       LIMIT ?6`,
    )
    .bind(
      input.query,
      SNIPPET_WINDOW_BEFORE,
      SNIPPET_WINDOW,
      input.userId,
      likePattern(input.query),
      SEARCH_LIMIT,
    )
    .all<SearchRow>();
  return results.map((row) => ({
    docId: row.doc_id,
    tabId: row.tab_id,
    tabTitle: row.tab_title,
    snippet: searchSnippet(row.window_text, input.query, {
      cutBefore: row.window_start > 1,
      cutAfter: row.window_start - 1 + row.window_text.length < row.total,
    }),
  }));
}
