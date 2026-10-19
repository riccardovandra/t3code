import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

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
