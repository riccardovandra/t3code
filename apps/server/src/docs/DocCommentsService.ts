import {
  type DocComment,
  type DocCommentAuthor,
  type DocCommentCreateInput,
  type DocCommentDeleteInput,
  type DocCommentMutationResult,
  type DocCommentReplyInput,
  type DocCommentSetResolvedInput,
  type DocCommentsListInput,
  type DocCommentsResult,
  DocsError,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

interface DocCommentRow {
  readonly comment_id: string;
  readonly project_id: string;
  readonly doc_path: string;
  readonly parent_id: string | null;
  readonly author_kind: string;
  readonly author_thread_id: string | null;
  readonly body: string;
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly resolved_at: string | null;
  readonly sent_to_thread_id: string | null;
  readonly created_at: string;
}

interface Authored {
  readonly author: DocCommentAuthor;
}

export class DocCommentsService extends Context.Service<
  DocCommentsService,
  {
    readonly list: (input: DocCommentsListInput) => Effect.Effect<DocCommentsResult, DocsError>;
    readonly listForProject: (input: {
      readonly projectId: ProjectId;
      readonly includeResolved: boolean;
    }) => Effect.Effect<ReadonlyArray<DocComment>, DocsError>;
    // Persistence only: sending to an agent is DocCommentDelivery's job, so an
    // agent's own comments can never echo back into a thread.
    readonly create: (
      input: Omit<DocCommentCreateInput, "sendFromThreadId"> & Authored,
    ) => Effect.Effect<DocCommentMutationResult, DocsError>;
    readonly reply: (
      input: Omit<DocCommentReplyInput, "sendFromThreadId"> & Authored,
    ) => Effect.Effect<DocCommentMutationResult, DocsError>;
    readonly markSent: (input: {
      readonly projectId: ProjectId;
      readonly commentId: string;
      readonly threadId: ThreadId;
    }) => Effect.Effect<DocCommentMutationResult, DocsError>;
    readonly setResolved: (
      input: DocCommentSetResolvedInput,
    ) => Effect.Effect<DocCommentMutationResult, DocsError>;
    readonly delete: (
      input: DocCommentDeleteInput,
    ) => Effect.Effect<DocCommentMutationResult, DocsError>;
  }
>()("t3/docs/DocCommentsService") {}

const author = (row: DocCommentRow): DocCommentAuthor => ({
  kind: row.author_kind === "agent" ? "agent" : "user",
  threadId: row.author_thread_id as ThreadId | null,
});

// Rows arrive ordered by (created_at, rowid), so roots and each reply list
// keep insertion order without sorting here.
const toComments = (rows: ReadonlyArray<DocCommentRow>): Array<DocComment> => {
  const replies = new Map<string, Array<DocComment["replies"][number]>>();
  for (const row of rows) {
    if (row.parent_id === null) continue;
    const list = replies.get(row.parent_id) ?? [];
    list.push({
      id: row.comment_id,
      author: author(row),
      body: row.body,
      createdAt: row.created_at,
      sentToThreadId: row.sent_to_thread_id as ThreadId | null,
    });
    replies.set(row.parent_id, list);
  }
  return rows
    .filter((row) => row.parent_id === null)
    .map((row) => ({
      id: row.comment_id,
      projectId: row.project_id as ProjectId,
      docPath: row.doc_path,
      quote: row.quote,
      prefix: row.prefix,
      suffix: row.suffix,
      author: author(row),
      body: row.body,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      sentToThreadId: row.sent_to_thread_id as ThreadId | null,
      replies: replies.get(row.comment_id) ?? [],
    }));
};

const commentNotFound = () => new DocsError({ reason: "comment_not_found" });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

  const persistence = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapError((cause) => Effect.logWarning("Doc comment persistence failed", { cause })),
      Effect.mapError(() => new DocsError({ reason: "persistence" })),
    );

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const newId = crypto.randomUUIDv4();

  const findRow = (projectId: ProjectId, commentId: string) =>
    persistence(
      sql<DocCommentRow>`
        SELECT * FROM doc_comments WHERE comment_id = ${commentId} AND project_id = ${projectId}
      `,
    ).pipe(
      Effect.flatMap(([row]) =>
        row === undefined ? Effect.fail(commentNotFound()) : Effect.succeed(row),
      ),
    );

  // A thread is a root plus its replies; mutations return the whole thread so
  // clients can replace one comment instead of refetching the doc.
  const readThread = (rootId: string) =>
    persistence(
      sql<DocCommentRow>`
        SELECT * FROM doc_comments
        WHERE comment_id = ${rootId} OR parent_id = ${rootId}
        ORDER BY created_at, rowid
      `,
    ).pipe(Effect.map((rows) => ({ comment: toComments(rows)[0] ?? null })));

  const rootOf = (row: DocCommentRow) => row.parent_id ?? row.comment_id;

  const list: DocCommentsService["Service"]["list"] = ({ projectId, docPath }) =>
    persistence(
      sql<DocCommentRow>`
        SELECT * FROM doc_comments
        WHERE project_id = ${projectId} AND doc_path = ${docPath}
        ORDER BY created_at, rowid
      `,
    ).pipe(Effect.map((rows) => ({ comments: toComments(rows) })));

  const listForProject: DocCommentsService["Service"]["listForProject"] = ({
    projectId,
    includeResolved,
  }) =>
    persistence(
      sql<DocCommentRow>`
        SELECT * FROM doc_comments
        WHERE project_id = ${projectId}
        ORDER BY doc_path, created_at, rowid
      `,
    ).pipe(
      Effect.map((rows) =>
        toComments(rows).filter((comment) => includeResolved || comment.resolvedAt === null),
      ),
    );

  const create: DocCommentsService["Service"]["create"] = Effect.fn("DocCommentsService.create")(
    function* (input) {
      const id = yield* persistence(newId);
      const createdAt = yield* now;
      yield* persistence(sql`
      INSERT INTO doc_comments (
        comment_id, project_id, doc_path, parent_id, author_kind, author_thread_id,
        body, quote, prefix, suffix, resolved_at, created_at
      ) VALUES (
        ${id}, ${input.projectId}, ${input.docPath}, NULL, ${input.author.kind},
        ${input.author.threadId}, ${input.body}, ${input.quote}, ${input.prefix},
        ${input.suffix}, NULL, ${createdAt}
      )
    `);
      return yield* readThread(id);
    },
  );

  const reply: DocCommentsService["Service"]["reply"] = Effect.fn("DocCommentsService.reply")(
    function* (input) {
      const target = yield* findRow(input.projectId, input.commentId);
      const rootId = rootOf(target);
      const id = yield* persistence(newId);
      const createdAt = yield* now;
      yield* persistence(sql`
      INSERT INTO doc_comments (
        comment_id, project_id, doc_path, parent_id, author_kind, author_thread_id,
        body, created_at
      ) VALUES (
        ${id}, ${target.project_id}, ${target.doc_path}, ${rootId}, ${input.author.kind},
        ${input.author.threadId}, ${input.body}, ${createdAt}
      )
    `);
      return yield* readThread(rootId);
    },
  );

  const setResolved: DocCommentsService["Service"]["setResolved"] = Effect.fn(
    "DocCommentsService.setResolved",
  )(function* (input) {
    const target = yield* findRow(input.projectId, input.commentId);
    const rootId = rootOf(target);
    const resolvedAt = input.resolved ? yield* now : null;
    yield* persistence(
      sql`UPDATE doc_comments SET resolved_at = ${resolvedAt} WHERE comment_id = ${rootId}`,
    );
    return yield* readThread(rootId);
  });

  const markSent: DocCommentsService["Service"]["markSent"] = Effect.fn(
    "DocCommentsService.markSent",
  )(function* (input) {
    const target = yield* findRow(input.projectId, input.commentId);
    yield* persistence(
      sql`UPDATE doc_comments SET sent_to_thread_id = ${input.threadId} WHERE comment_id = ${target.comment_id}`,
    );
    return yield* readThread(rootOf(target));
  });

  const remove: DocCommentsService["Service"]["delete"] = Effect.fn("DocCommentsService.remove")(
    function* (input) {
      const target = yield* findRow(input.projectId, input.commentId);
      if (target.parent_id === null) {
        yield* persistence(
          sql`DELETE FROM doc_comments WHERE comment_id = ${target.comment_id} OR parent_id = ${target.comment_id}`,
        );
        return { comment: null };
      }
      yield* persistence(sql`DELETE FROM doc_comments WHERE comment_id = ${target.comment_id}`);
      return yield* readThread(target.parent_id);
    },
  );

  return DocCommentsService.of({
    list,
    listForProject,
    create,
    reply,
    setResolved,
    markSent,
    delete: remove,
  });
});

export const layer = Layer.effect(DocCommentsService, make);
