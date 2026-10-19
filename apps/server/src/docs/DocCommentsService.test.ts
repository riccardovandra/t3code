import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runMigrations } from "../persistence/Migrations.ts";
import * as DocCommentsService from "./DocCommentsService.ts";

const projectId = ProjectId.make("project-docs");
const otherProjectId = ProjectId.make("project-other");
const user = { kind: "user", threadId: null } as const;
const agent = { kind: "agent", threadId: ThreadId.make("thread-agent") } as const;

const layer = it.layer(
  DocCommentsService.layer.pipe(
    Layer.provideMerge(
      Layer.effectDiscard(runMigrations()).pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
      ),
    ),
    Layer.provide(NodeCrypto.layer),
  ),
);

const createComment = (docPath: string, quote: string, body: string) =>
  Effect.flatMap(DocCommentsService.DocCommentsService, (docs) =>
    docs.create({ projectId, docPath, quote, prefix: "", suffix: "", body, author: user }),
  ).pipe(Effect.map(({ comment }) => comment!));

layer("DocCommentsService", (it) => {
  it.effect("lists a doc's comments in creation order with replies nested under their root", () =>
    Effect.gen(function* () {
      const docs = yield* DocCommentsService.DocCommentsService;
      const first = yield* createComment("specs/a.md", "alpha", "First");
      const second = yield* createComment("specs/a.md", "beta", "Second");
      yield* createComment("specs/b.md", "gamma", "Other doc");

      const replied = yield* docs.reply({
        projectId,
        commentId: first.id,
        body: "Done",
        author: agent,
      });
      const reply = replied.comment!.replies[0]!;
      // Replying to a reply joins the root's thread rather than nesting deeper.
      const nested = yield* docs.reply({
        projectId,
        commentId: reply.id,
        body: "Thanks",
        author: user,
      });
      assert.strictEqual(nested.comment?.id, first.id);

      const { comments } = yield* docs.list({ projectId, docPath: "specs/a.md" });
      assert.deepStrictEqual(
        comments.map((comment) => comment.id),
        [first.id, second.id],
      );
      assert.deepStrictEqual(
        comments[0]!.replies.map((entry) => [entry.body, entry.author]),
        [
          ["Done", agent],
          ["Thanks", user],
        ],
      );
      assert.strictEqual(comments[0]!.quote, "alpha");
    }),
  );

  it.effect("resolves and reopens a thread, and filters resolved threads for agents", () =>
    Effect.gen(function* () {
      const docs = yield* DocCommentsService.DocCommentsService;
      const comment = yield* createComment("notes/resolve.md", "quote", "Fix this");
      const reply = (yield* docs.reply({
        projectId,
        commentId: comment.id,
        body: "ok",
        author: agent,
      })).comment!.replies[0]!;

      // Resolving through a reply resolves its thread.
      const resolved = yield* docs.setResolved({ projectId, commentId: reply.id, resolved: true });
      assert.isNotNull(resolved.comment?.resolvedAt);
      const open = yield* docs.listForProject({ projectId, includeResolved: false });
      assert.isFalse(open.some((entry) => entry.id === comment.id));
      const all = yield* docs.listForProject({ projectId, includeResolved: true });
      assert.isTrue(all.some((entry) => entry.id === comment.id));

      const reopened = yield* docs.setResolved({
        projectId,
        commentId: comment.id,
        resolved: false,
      });
      assert.isNull(reopened.comment?.resolvedAt);
    }),
  );

  it.effect("deletes a reply alone and a root with its replies", () =>
    Effect.gen(function* () {
      const docs = yield* DocCommentsService.DocCommentsService;
      const comment = yield* createComment("notes/delete.md", "quote", "Root");
      yield* docs.reply({ projectId, commentId: comment.id, body: "keep", author: user });
      const withReplies = yield* docs.reply({
        projectId,
        commentId: comment.id,
        body: "drop",
        author: user,
      });
      const drop = withReplies.comment!.replies[1]!;

      const afterReply = yield* docs.delete({ projectId, commentId: drop.id });
      assert.deepStrictEqual(
        afterReply.comment?.replies.map((entry) => entry.body),
        ["keep"],
      );

      const afterRoot = yield* docs.delete({ projectId, commentId: comment.id });
      assert.isNull(afterRoot.comment);
      const { comments } = yield* docs.list({ projectId, docPath: "notes/delete.md" });
      assert.deepStrictEqual(comments, []);
      const orphan = yield* docs
        .reply({
          projectId,
          commentId: withReplies.comment!.replies[0]!.id,
          body: "x",
          author: user,
        })
        .pipe(Effect.flip);
      assert.strictEqual(orphan.reason, "comment_not_found");
    }),
  );

  it.effect("refuses to touch a comment through another project", () =>
    Effect.gen(function* () {
      const docs = yield* DocCommentsService.DocCommentsService;
      const comment = yield* createComment("notes/scope.md", "quote", "Mine");
      const errors = yield* Effect.all(
        [
          docs.reply({ projectId: otherProjectId, commentId: comment.id, body: "x", author: user }),
          docs.setResolved({ projectId: otherProjectId, commentId: comment.id, resolved: true }),
          docs.delete({ projectId: otherProjectId, commentId: comment.id }),
        ].map(Effect.flip),
      );
      assert.deepStrictEqual(
        errors.map((error) => error.reason),
        ["comment_not_found", "comment_not_found", "comment_not_found"],
      );
      const { comments } = yield* docs.list({ projectId, docPath: "notes/scope.md" });
      assert.strictEqual(comments[0]?.resolvedAt, null);
    }),
  );
});
