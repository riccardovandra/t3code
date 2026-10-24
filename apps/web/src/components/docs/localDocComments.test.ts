import type { DocComment, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { LocalRequestMessage } from "@t3tools/shared/docsCloudLocal";
import { describe, expect, it } from "vite-plus/test";

import type { ReviewCommentContext } from "~/reviewCommentContext";

import { answerLocalDocsRequest, type LocalDocsContext } from "./localDocsBridge";
import {
  localCommentHandlers,
  type LocalCommentsOptions,
  type LocalDocCommentsApi,
} from "./localDocComments";

const projectId = "project-1" as ProjectId;
const conversation = "thread-main" as ThreadId;
const docAgent = "thread-doc-agent" as ThreadId;

/** A comment as the old Docs panel stored it, with a reply from the doc agent. */
const oldPanelComment: DocComment = {
  id: "c1",
  projectId,
  docPath: "docs/plan.md",
  quote: "ships Friday",
  prefix: "Intro line\nThe plan ",
  suffix: ".",
  author: { kind: "user", threadId: null },
  body: "Can we make it Thursday?",
  createdAt: "2026-10-20T10:00:00.000Z",
  resolvedAt: null,
  sentToThreadId: docAgent,
  replies: [
    {
      id: "c2",
      author: { kind: "agent", threadId: docAgent },
      body: "Moved to Thursday.",
      createdAt: "2026-10-20T10:05:00.000Z",
      sentToThreadId: null,
    },
  ],
};

function fakeServer(options: Partial<LocalCommentsOptions> = {}) {
  const store = new Map<string, Array<DocComment>>([["docs/plan.md", [oldPanelComment]]]);
  const calls: Array<[string, unknown]> = [];
  const chat: Array<ReviewCommentContext> = [];
  const agentThreads: Array<ReadonlyArray<ThreadId>> = [];
  const api: LocalDocCommentsApi = {
    list: async (_project, path) => store.get(path) ?? [],
    create: async (input) => {
      calls.push(["create", input]);
      const comment: DocComment = {
        ...oldPanelComment,
        id: "c3",
        docPath: input.docPath,
        quote: input.quote,
        prefix: input.prefix,
        suffix: input.suffix,
        body: input.body,
        sentToThreadId: null,
        replies: [],
      };
      store.set(input.docPath, [...(store.get(input.docPath) ?? []), comment]);
      return comment;
    },
    reply: async (input) => void calls.push(["reply", input]),
    setResolved: async (input) => void calls.push(["setResolved", input]),
    delete: async (input) => void calls.push(["delete", input]),
  };
  const handlers = localCommentHandlers({
    api,
    canComment: true,
    sendFromThreadId: conversation,
    addToChat: (comment) => chat.push(comment),
    onAgentThreads: (ids) => agentThreads.push(ids),
    ...options,
  });
  const context = {
    environmentId: "env-1" as EnvironmentId,
    projectId,
    cwd: "/repo",
    canWrite: true,
    files: {
      list: async () => [],
      read: async () => ({ contents: "", truncated: false }),
      write: async () => undefined,
    },
  } satisfies LocalDocsContext;
  const ask = (request: LocalRequestMessage["request"]) =>
    answerLocalDocsRequest(
      { type: "t3-docs:local-request", requestId: "r1", request },
      handlers,
      context,
    );
  return { ask, calls, chat, agentThreads };
}

describe("localCommentHandlers", () => {
  it("lists old-panel comments flat, with their anchors unchanged", async () => {
    const server = fakeServer();
    const reply = await server.ask({ kind: "comments.list", path: "docs/plan.md" });
    expect(reply).toMatchObject({ ok: true });
    expect(reply.ok && reply.result).toEqual({
      comments: [
        {
          id: "c1",
          parentId: null,
          quote: "ships Friday",
          prefix: "Intro line\nThe plan ",
          suffix: ".",
          body: "Can we make it Thursday?",
          author: "user",
          resolvedAt: null,
          createdAt: Date.parse("2026-10-20T10:00:00.000Z"),
        },
        {
          id: "c2",
          parentId: "c1",
          quote: "",
          prefix: "",
          suffix: "",
          body: "Moved to Thursday.",
          author: "agent",
          resolvedAt: null,
          createdAt: Date.parse("2026-10-20T10:05:00.000Z"),
        },
      ],
      canComment: true,
      canSendToAgent: true,
    });
    // The panel watches the doc agent's turns, which answer these comments.
    expect(server.agentThreads).toEqual([[docAgent]]);
  });

  it("sends a comment to the conversation's doc agent only when asked", async () => {
    const server = fakeServer();
    const anchor = { quote: "plan", prefix: "The ", suffix: " ships" };
    const sent = await server.ask({
      kind: "comment.create",
      path: "docs/plan.md",
      ...anchor,
      body: "Why?",
      sendToAgent: true,
    });
    expect(sent.ok && sent.result).toMatchObject({ commentId: "c3" });
    await server.ask({
      kind: "comment.reply",
      path: "docs/plan.md",
      commentId: "c1",
      body: "Thanks",
      sendToAgent: false,
    });
    expect(server.calls).toEqual([
      [
        "create",
        {
          projectId,
          docPath: "docs/plan.md",
          ...anchor,
          body: "Why?",
          sendFromThreadId: conversation,
        },
      ],
      ["reply", { projectId, commentId: "c1", body: "Thanks" }],
    ]);
  });

  it("offers no agent before the conversation exists", async () => {
    const server = fakeServer({ sendFromThreadId: null });
    const listed = await server.ask({ kind: "comments.list", path: "docs/plan.md" });
    expect(listed.ok && listed.result).toMatchObject({ canSendToAgent: false });
    await server.ask({
      kind: "comment.reply",
      path: "docs/plan.md",
      commentId: "c1",
      body: "Thanks",
      sendToAgent: true,
    });
    expect(server.calls).toEqual([["reply", { projectId, commentId: "c1", body: "Thanks" }]]);
  });

  it("resolves, reopens and deletes only comments on the named file", async () => {
    const server = fakeServer();
    await server.ask({
      kind: "comment.resolve",
      path: "docs/plan.md",
      commentId: "c1",
      resolved: true,
    });
    await server.ask({
      kind: "comment.resolve",
      path: "docs/plan.md",
      commentId: "c1",
      resolved: false,
    });
    await server.ask({ kind: "comment.delete", path: "docs/plan.md", commentId: "c2" });
    const elsewhere = await server.ask({
      kind: "comment.delete",
      path: "docs/other.md",
      commentId: "c1",
    });
    expect(elsewhere).toMatchObject({ ok: false, error: "This comment no longer exists." });
    expect(server.calls).toEqual([
      ["setResolved", { projectId, commentId: "c1", resolved: true }],
      ["setResolved", { projectId, commentId: "c1", resolved: false }],
      ["delete", { projectId, commentId: "c2" }],
    ]);
  });

  it("refuses changes from a connection that may not comment", async () => {
    const server = fakeServer({ canComment: false });
    const listed = await server.ask({ kind: "comments.list", path: "docs/plan.md" });
    expect(listed.ok && listed.result).toMatchObject({ canComment: false, canSendToAgent: false });
    const refused = await server.ask({
      kind: "comment.resolve",
      path: "docs/plan.md",
      commentId: "c1",
      resolved: true,
    });
    expect(refused).toMatchObject({ ok: false });
    expect(server.calls).toEqual([]);
  });

  it("adds a thread to the chat with what the agent needs to answer it", async () => {
    const server = fakeServer();
    const added = await server.ask({ kind: "comment.chat", path: "docs/plan.md", commentId: "c1" });
    expect(added).toMatchObject({ ok: true, result: { added: true } });
    expect(server.chat).toEqual([
      expect.objectContaining({
        filePath: "docs/plan.md",
        sectionTitle: "Doc comment c1 (reply with docs_comment_reply)",
        text: "Can we make it Thursday?",
        diff: "ships Friday",
      }),
    ]);
  });
});
