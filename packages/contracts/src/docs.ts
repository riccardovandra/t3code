import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

// Docs are markdown files in the project, read and written through the
// existing project file RPCs. Only comments live on the server, keyed by
// project rather than checkout so every worktree of a project shares them.
export const DocPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/\.md$/i),
);
export type DocPath = typeof DocPath.Type;

export const DocCommentId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type DocCommentId = typeof DocCommentId.Type;

const CommentBody = TrimmedNonEmptyString.check(Schema.isMaxLength(10_000));

export const DocCommentAuthor = Schema.Struct({
  kind: Schema.Literals(["user", "agent"]),
  threadId: Schema.NullOr(ThreadId),
});
export type DocCommentAuthor = typeof DocCommentAuthor.Type;

export const DocCommentReply = Schema.Struct({
  id: DocCommentId,
  author: DocCommentAuthor,
  body: Schema.String,
  createdAt: IsoDateTime,
  sentToThreadId: Schema.NullOr(ThreadId),
});
export type DocCommentReply = typeof DocCommentReply.Type;

/**
 * A comment anchors to a text quote plus a little surrounding context rather
 * than to offsets, so it survives edits elsewhere in the doc. When the quote
 * no longer appears, clients show the comment as detached instead of losing it.
 */
export const DocComment = Schema.Struct({
  id: DocCommentId,
  projectId: ProjectId,
  docPath: DocPath,
  quote: Schema.String,
  prefix: Schema.String,
  suffix: Schema.String,
  author: DocCommentAuthor,
  body: Schema.String,
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
  // The doc agent thread that received the comment. Set only once the message
  // reached it, so a failed send never reads as sent.
  sentToThreadId: Schema.NullOr(ThreadId),
  replies: Schema.Array(DocCommentReply),
});
export type DocComment = typeof DocComment.Type;

export const DocCommentsListInput = Schema.Struct({
  projectId: ProjectId,
  docPath: DocPath,
});
export type DocCommentsListInput = typeof DocCommentsListInput.Type;

export const DocCommentsResult = Schema.Struct({
  comments: Schema.Array(DocComment),
});
export type DocCommentsResult = typeof DocCommentsResult.Type;

export const DocCommentCreateInput = Schema.Struct({
  projectId: ProjectId,
  docPath: DocPath,
  quote: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
  prefix: Schema.String.check(Schema.isMaxLength(200)),
  suffix: Schema.String.check(Schema.isMaxLength(200)),
  body: CommentBody,
  // The conversation the user is in. The server delivers to that thread's
  // doc agent for this doc, never into the conversation itself.
  sendFromThreadId: Schema.optional(ThreadId),
});
export type DocCommentCreateInput = typeof DocCommentCreateInput.Type;

export const DocCommentReplyInput = Schema.Struct({
  projectId: ProjectId,
  commentId: DocCommentId,
  body: CommentBody,
  sendFromThreadId: Schema.optional(ThreadId),
});
export type DocCommentReplyInput = typeof DocCommentReplyInput.Type;

export const DocCommentSetResolvedInput = Schema.Struct({
  projectId: ProjectId,
  commentId: DocCommentId,
  resolved: Schema.Boolean,
});
export type DocCommentSetResolvedInput = typeof DocCommentSetResolvedInput.Type;

export const DocCommentDeleteInput = Schema.Struct({
  projectId: ProjectId,
  commentId: DocCommentId,
});
export type DocCommentDeleteInput = typeof DocCommentDeleteInput.Type;

export const DocCommentMutationResult = Schema.Struct({
  comment: Schema.NullOr(DocComment),
});
export type DocCommentMutationResult = typeof DocCommentMutationResult.Type;

// Docs Cloud docs live in the hosted app, not the project, so a comment sent
// from its embed carries the thread itself: the server only routes it to the
// conversation's doc agent for that Docs Cloud doc.
const DocsCloudId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

export const DocsCloudCommentEntry = Schema.Struct({
  id: DocsCloudId,
  author: Schema.Literals(["user", "agent"]),
  body: Schema.String.check(Schema.isMaxLength(10_000)),
});
export type DocsCloudCommentEntry = typeof DocsCloudCommentEntry.Type;

export const DocsCloudCommentSendInput = Schema.Struct({
  // The conversation the Docs panel belongs to. Delivery goes to its doc agent.
  fromThreadId: ThreadId,
  // One per click, so a retried request replays and a second click sends again.
  requestId: DocsCloudId,
  docId: DocsCloudId,
  tabId: DocsCloudId,
  docTitle: Schema.String.check(Schema.isMaxLength(500)),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
  commentId: DocsCloudId,
  quote: Schema.String.check(Schema.isMaxLength(2_000)),
  entries: Schema.Array(DocsCloudCommentEntry).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200),
  ),
});
export type DocsCloudCommentSendInput = typeof DocsCloudCommentSendInput.Type;

export const DocsCloudCommentSendResult = Schema.Struct({
  // The doc agent thread that received the comment.
  threadId: ThreadId,
});
export type DocsCloudCommentSendResult = typeof DocsCloudCommentSendResult.Type;

export class DocsError extends Schema.TaggedError<DocsError>()("DocsError", {
  reason: Schema.Literals([
    "comment_not_found",
    "persistence",
    "thread_not_found",
    "delivery_failed",
  ]),
}) {
  override get message(): string {
    switch (this.reason) {
      case "comment_not_found":
        return "This comment no longer exists.";
      case "persistence":
        return "Doc comments could not be saved. Try again.";
      case "thread_not_found":
        return "The thread to send this comment to no longer exists.";
      case "delivery_failed":
        return "The comment was saved, but it could not be sent to the agent.";
    }
  }
}

// Moving file docs into Docs Cloud. Each T3 project imports into the Docs Cloud
// project with the same name; the server holds the token and records each
// imported file so a second import skips it or updates the same doc.
export const DocsCloudProject = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.String,
  url: Schema.String,
});
export type DocsCloudProject = typeof DocsCloudProject.Type;

export const DocsCloudImportRecord = Schema.Struct({
  docPath: DocPath,
  docId: TrimmedNonEmptyString,
  url: Schema.String,
  importedAt: IsoDateTime,
});
export type DocsCloudImportRecord = typeof DocsCloudImportRecord.Type;

export const DocsCloudImportsInput = Schema.Struct({
  projectId: ProjectId,
  cwd: TrimmedNonEmptyString,
});
export type DocsCloudImportsInput = typeof DocsCloudImportsInput.Type;

export const DocsCloudImportsResult = Schema.Struct({
  // Every doc under docs/ in the checkout, so a client can import them one by one.
  docs: Schema.Array(Schema.Struct({ docPath: DocPath, title: Schema.String })),
  imports: Schema.Array(DocsCloudImportRecord),
});
export type DocsCloudImportsResult = typeof DocsCloudImportsResult.Type;

export const DocsCloudImportInput = Schema.Struct({
  projectId: ProjectId,
  // The checkout to read files from; comments are shared by every checkout of the project.
  cwd: TrimmedNonEmptyString,
  // Omitted imports every doc under docs/.
  docPaths: Schema.optional(Schema.Array(DocPath).check(Schema.isMaxLength(200))),
  // Already-imported docs are skipped unless this replaces their first tab with the file.
  update: Schema.optional(Schema.Boolean),
});
export type DocsCloudImportInput = typeof DocsCloudImportInput.Type;

export const DocsCloudSkippedComment = Schema.Struct({
  commentId: DocCommentId,
  quote: Schema.String,
  reason: Schema.Literals(["text_not_found", "failed"]),
});
export type DocsCloudSkippedComment = typeof DocsCloudSkippedComment.Type;

export const DocsCloudImportFileResult = Schema.Struct({
  docPath: Schema.String,
  status: Schema.Literals(["imported", "updated", "skipped", "failed"]),
  doc: Schema.NullOr(DocsCloudImportRecord),
  error: Schema.NullOr(Schema.String),
  commentsImported: NonNegativeInt,
  commentsSkipped: Schema.Array(DocsCloudSkippedComment),
});
export type DocsCloudImportFileResult = typeof DocsCloudImportFileResult.Type;

export const DocsCloudImportResult = Schema.Struct({
  project: DocsCloudProject,
  results: Schema.Array(DocsCloudImportFileResult),
});
export type DocsCloudImportResult = typeof DocsCloudImportResult.Type;

export class DocsCloudError extends Schema.TaggedError<DocsCloudError>()("DocsCloudError", {
  reason: Schema.Literals([
    "not_configured",
    "unreachable",
    "unauthorized",
    "failed",
    "not_found",
    "persistence",
  ]),
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not_configured":
        return "Docs Cloud is not set up. Add it under Settings > MCP servers.";
      case "unreachable":
        return "Docs Cloud could not be reached. Check the connection and try again.";
      case "unauthorized":
        return "Docs Cloud rejected the API token. Paste a new one under Settings > MCP servers.";
      case "failed":
        return `Docs Cloud returned an error${this.detail ? ` (${this.detail})` : ""}.`;
      case "not_found":
        return "The T3 Code project was not found.";
      case "persistence":
        return "The import record could not be saved. Try again.";
    }
  }
}
