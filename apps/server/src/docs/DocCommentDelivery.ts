import {
  CommandId,
  type DocComment,
  type DocCommentCreateInput,
  type DocCommentMutationResult,
  type DocCommentReplyInput,
  DocsError,
  type DocsCloudCommentSendInput,
  type DocsCloudCommentSendResult,
  MessageId,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as DocCommentsService from "./DocCommentsService.ts";

const user = { kind: "user", threadId: null } as const;

const HISTORY_BUDGET = 4_000;

/**
 * Comments a user writes from a client. With `sendFromThreadId` the comment is
 * saved first and then delivered to that conversation's doc agent: a subagent
 * thread per (conversation, doc), created on first use, that acts on it and
 * answers with docs_comment_reply. Agents comment through DocCommentsService
 * directly, so they never trigger a delivery.
 *
 * `sendCloudComment` does the same for a Docs Cloud comment thread. Docs Cloud
 * stores the comment itself, so nothing is saved here: the thread is routed to
 * the conversation's doc agent for that Docs Cloud doc, which answers with the
 * docs-cloud reply_comment tool.
 */
export class DocCommentDelivery extends Context.Service<
  DocCommentDelivery,
  {
    readonly create: (
      input: DocCommentCreateInput,
    ) => Effect.Effect<DocCommentMutationResult, DocsError>;
    readonly reply: (
      input: DocCommentReplyInput,
    ) => Effect.Effect<DocCommentMutationResult, DocsError>;
    readonly sendCloudComment: (
      input: DocsCloudCommentSendInput,
    ) => Effect.Effect<DocsCloudCommentSendResult, DocsError>;
  }
>()("t3/docs/DocCommentDelivery") {}

interface HistoryEntry {
  readonly author: "user" | "agent";
  readonly body: string;
}

const historyLines = (entries: ReadonlyArray<HistoryEntry>): Array<string> => {
  const lines: Array<string> = [];
  let budget = HISTORY_BUDGET;
  for (const entry of entries.toReversed()) {
    if (budget <= 0) {
      lines.push("- (earlier messages omitted)");
      break;
    }
    const line = `- ${entry.author === "agent" ? "Agent" : "You"}: ${entry.body}`;
    lines.push(line.length > budget ? `${line.slice(0, budget)}…` : line);
    budget -= line.length;
  }
  return lines.toReversed();
};

const deliveryMessage = (thread: DocComment, entryId: string): string => {
  const entries = [thread, ...thread.replies];
  const index = entries.findIndex((entry) => entry.id === entryId);
  const entry = entries[index]!;
  const earlier = historyLines(
    entries.slice(0, index).map(({ author, body }) => ({ author: author.kind, body })),
  );
  return [
    "[Doc comment sent to agent]",
    `Doc: ${thread.docPath}`,
    `Comment thread: ${thread.id}`,
    `Quoted text: "${thread.quote}"`,
    "",
    entry.body,
    ...(earlier.length === 0 ? [] : ["", "Earlier in this thread:", ...earlier]),
    "",
    `If the comment asks for a change, edit the doc file directly. Then reply in the comment thread with docs_comment_reply (commentId: ${thread.id}) saying briefly what you changed, or answer the question there. Do not resolve threads the user wrote in unless asked.`,
  ].join("\n");
};

const rolePreface = (docPath: string): string =>
  `You are the doc agent for ${docPath} in this project. The user reviews this doc in T3 Code's Docs panel and sends you comments from it. Address each comment by editing the file, then reply in its thread with docs_comment_reply. Keep replies short.`;

/** The newest message is the one to act on; the rest is context. */
export const cloudDeliveryMessage = (input: DocsCloudCommentSendInput): string => {
  const entry = input.entries.at(-1)!;
  const earlier = historyLines(input.entries.slice(0, -1));
  return [
    "[Docs Cloud comment sent to agent]",
    `Doc: ${JSON.stringify(input.docTitle)} ${input.url}`,
    `Docs Cloud doc id: ${input.docId}, tab id: ${input.tabId}`,
    `Comment thread: ${input.commentId}`,
    `Quoted text: "${input.quote}"`,
    "",
    entry.body,
    ...(earlier.length === 0 ? [] : ["", "Earlier in this thread:", ...earlier]),
    "",
    `If the comment asks for a change, read the tab with the docs-cloud read_doc tool (docId: ${input.docId}, tabId: ${input.tabId}) and change it with edit_tab. Then reply in the comment thread with reply_comment (commentId: ${input.commentId}) saying briefly what you changed, or answer the question there. Do not resolve threads the user wrote in unless asked.`,
  ].join("\n");
};

const cloudRolePreface = (input: DocsCloudCommentSendInput): string =>
  `You are the doc agent for the Docs Cloud doc ${JSON.stringify(input.docTitle)} (${input.url}). The user reviews it in T3 Code's Docs panel and sends you comments from it. Address each comment with the docs-cloud MCP tools, then reply in its thread with reply_comment. Keep replies short.`;

/** Docs Cloud docs share the doc agent table with project docs under this prefix. */
const cloudDocKey = (docId: string) => `docs-cloud:${docId}`;

const docAgentTitle = (docPath: string): string => {
  const name = docPath.split("/").at(-1)!.replace(/\.md$/i, "").trim();
  return `Doc: ${name === "" ? docPath : name}`;
};

interface DocAgent {
  readonly threadId: ThreadId;
  readonly created: boolean;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const docs = yield* DocCommentsService.DocCommentsService;
  const threads = yield* ThreadManagementService.ThreadManagementService;

  // The comment is already saved by the time anything below fails, so every
  // failure past validation reads as an undelivered comment.
  const deliveryFailed =
    (message: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.tapError((cause) => Effect.logWarning(message, { cause })),
        Effect.mapError(() => new DocsError({ reason: "delivery_failed" })),
      );

  // Checked before saving so a stale target leaves nothing behind to retry around.
  const loadParent = (threadId: ThreadId, projectId: ProjectId) =>
    threads.getThreadShell(threadId).pipe(
      Effect.tapError((cause) => Effect.logWarning("Doc comment thread lookup failed", { cause })),
      Effect.mapError(() => new DocsError({ reason: "persistence" })),
      Effect.flatMap((shell) =>
        shell === null || shell.projectId !== projectId
          ? Effect.fail(new DocsError({ reason: "thread_not_found" }))
          : Effect.succeed(shell),
      ),
    );

  const resolveDocAgent = (
    parent: OrchestrationV2ThreadShell,
    docPath: string,
    title = docAgentTitle(docPath),
  ) =>
    Effect.gen(function* () {
      const [row] = yield* sql<{ readonly thread_id: string }>`
        SELECT thread_id FROM doc_agent_threads
        WHERE parent_thread_id = ${parent.id} AND doc_path = ${docPath}
      `;
      const mapped = row === undefined ? null : ThreadId.make(row.thread_id);
      if (mapped !== null) {
        const shell = yield* threads.getThreadShell(mapped);
        if (shell !== null && shell.archivedAt === null) {
          return { threadId: mapped, created: false } satisfies DocAgent;
        }
      }
      // Ids derive from the parent, the doc and the thread being replaced, so
      // concurrent sends from any connection dispatch the same thread.create and
      // the orchestrator's command receipt turns the later one into a replay.
      const digest = yield* crypto.digest(
        "SHA-256",
        new TextEncoder().encode([parent.id, docPath, mapped ?? ""].join("\0")),
      );
      const key = Hex.encode(digest).slice(0, 32);
      const threadId = ThreadId.make(`thread:doc-agent:${key}`);
      yield* threads.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`command:doc-agent:${key}`),
        threadId,
        projectId: parent.projectId,
        parentThreadId: parent.id,
        title,
        modelSelection: parent.modelSelection,
        runtimeMode: parent.runtimeMode,
        interactionMode: parent.interactionMode,
        // The parent's checkout, so the agent edits the files the user is viewing.
        branch: parent.branch,
        worktreePath: parent.worktreePath,
        createdBy: "user",
        creationSource: "web",
      });
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO doc_agent_threads (parent_thread_id, doc_path, thread_id, created_at)
        VALUES (${parent.id}, ${docPath}, ${threadId}, ${createdAt})
        ON CONFLICT (parent_thread_id, doc_path)
        DO UPDATE SET thread_id = excluded.thread_id, created_at = excluded.created_at
      `;
      return { threadId, created: true } satisfies DocAgent;
    }).pipe(deliveryFailed("Doc agent thread could not be resolved"));

  const deliver = (parent: OrchestrationV2ThreadShell, thread: DocComment, entryId: string) =>
    Effect.gen(function* () {
      const agent = yield* resolveDocAgent(parent, thread.docPath);
      const message = deliveryMessage(thread, entryId);
      yield* threads
        .sendToThread({
          projectId: thread.projectId,
          // Comment ids are fresh UUIDs, so they make the dispatch ids unique.
          commandId: CommandId.make(`command:doc-comment:${entryId}`),
          messageId: MessageId.make(`message:doc-comment:${entryId}`),
          threadId: agent.threadId,
          text: agent.created ? `${rolePreface(thread.docPath)}\n\n${message}` : message,
          attachments: [],
          mode: "auto",
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(deliveryFailed("Doc comment delivery failed"));
      return yield* docs.markSent({
        projectId: thread.projectId,
        commentId: entryId,
        threadId: agent.threadId,
      });
    });

  const create: DocCommentDelivery["Service"]["create"] = ({ sendFromThreadId, ...input }) =>
    Effect.gen(function* () {
      if (sendFromThreadId === undefined) return yield* docs.create({ ...input, author: user });
      const parent = yield* loadParent(sendFromThreadId, input.projectId);
      const saved = yield* docs.create({ ...input, author: user });
      const thread = saved.comment!;
      return yield* deliver(parent, thread, thread.id);
    });

  const reply: DocCommentDelivery["Service"]["reply"] = ({ sendFromThreadId, ...input }) =>
    Effect.gen(function* () {
      if (sendFromThreadId === undefined) return yield* docs.reply({ ...input, author: user });
      const parent = yield* loadParent(sendFromThreadId, input.projectId);
      const saved = yield* docs.reply({ ...input, author: user });
      const thread = saved.comment!;
      // Replies list in insertion order, so the one just written is last.
      const entry = thread.replies.at(-1)!;
      return yield* deliver(parent, thread, entry.id);
    });

  const sendCloudComment: DocCommentDelivery["Service"]["sendCloudComment"] = (input) =>
    Effect.gen(function* () {
      const parent = yield* threads.getThreadShell(input.fromThreadId).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Docs Cloud comment thread lookup failed", { cause }),
        ),
        Effect.mapError(() => new DocsError({ reason: "persistence" })),
      );
      if (parent === null) return yield* Effect.fail(new DocsError({ reason: "thread_not_found" }));
      const name = input.docTitle.trim();
      const agent = yield* resolveDocAgent(
        parent,
        cloudDocKey(input.docId),
        `Doc: ${name === "" ? "Docs Cloud doc" : name}`,
      );
      const message = cloudDeliveryMessage(input);
      yield* threads
        .sendToThread({
          projectId: parent.projectId,
          commandId: CommandId.make(`command:docs-cloud-comment:${input.requestId}`),
          messageId: MessageId.make(`message:docs-cloud-comment:${input.requestId}`),
          threadId: agent.threadId,
          text: agent.created ? `${cloudRolePreface(input)}\n\n${message}` : message,
          attachments: [],
          mode: "auto",
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(deliveryFailed("Docs Cloud comment delivery failed"));
      return { threadId: agent.threadId };
    });

  return DocCommentDelivery.of({ create, reply, sendCloudComment });
});

export const layer = Layer.effect(DocCommentDelivery, make);
