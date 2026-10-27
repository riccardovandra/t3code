import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as DocCommentDelivery from "./DocCommentDelivery.ts";
import * as DocCommentsService from "./DocCommentsService.ts";

type ThreadCreate = Extract<OrchestrationV2ServerCommand, { readonly type: "thread.create" }>;

const projectId = ProjectId.make("project-docs");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.1-codex" };

const shells = new Map<ThreadId, OrchestrationV2ThreadShell>();
const creates: Array<ThreadCreate> = [];
const sent: Array<ThreadManagementService.ThreadManagementSendInput> = [];
const acceptedCommands = new Set<string>();

const addThread = (
  id: string,
  overrides: Partial<{
    projectId: ProjectId;
    branch: string | null;
    worktreePath: string | null;
    parentThreadId: ThreadId | null;
  }> = {},
) => {
  const threadId = ThreadId.make(id);
  shells.set(threadId, {
    id: threadId,
    projectId: overrides.projectId ?? projectId,
    modelSelection,
    providerInstanceId: modelSelection.instanceId,
    runtimeMode: "approval-required",
    interactionMode: "plan",
    branch: overrides.branch ?? null,
    worktreePath: overrides.worktreePath ?? null,
    lineage: {
      parentThreadId: overrides.parentThreadId ?? null,
      relationshipToParent: overrides.parentThreadId ? "subagent" : null,
      rootThreadId: threadId,
    },
    archivedAt: null,
  } as unknown as OrchestrationV2ThreadShell);
  return threadId;
};

const conversation = addThread("thread-conversation", {
  branch: "feature/docs",
  worktreePath: "/repo/.worktrees/docs",
});
const otherConversation = addThread("thread-other-conversation");
const failingConversation = addThread("thread-failing-conversation");
const foreignThread = addThread("thread-foreign", { projectId: ProjectId.make("project-other") });

// Mirrors the orchestrator: a repeated command id replays, a reused thread id is refused.
const threads = Layer.mock(ThreadManagementService.ThreadManagementService)({
  getThreadShell: (threadId: ThreadId) => Effect.succeed(shells.get(threadId) ?? null),
  dispatch: (command: OrchestrationV2ServerCommand) => {
    if (command.type !== "thread.create") return Effect.die("unexpected command");
    if (acceptedCommands.has(command.commandId)) return Effect.succeed({} as never);
    if (shells.has(command.threadId)) {
      return Effect.fail(
        new Orchestrator.OrchestratorThreadAlreadyExistsError({
          commandId: command.commandId,
          threadId: command.threadId,
        }),
      );
    }
    acceptedCommands.add(command.commandId);
    creates.push(command);
    addThread(command.threadId, {
      projectId: command.projectId,
      branch: command.branch,
      worktreePath: command.worktreePath,
      parentThreadId: command.parentThreadId ?? null,
    });
    return Effect.succeed({} as never);
  },
  sendToThread: (input: ThreadManagementService.ThreadManagementSendInput) => {
    if (shells.get(input.threadId)?.lineage.parentThreadId === failingConversation) {
      return Effect.fail(
        new ThreadManagementService.ThreadManagementThreadArchivedError({
          threadId: input.threadId,
        }),
      );
    }
    sent.push(input);
    return Effect.succeed({} as never);
  },
});

const layer = it.layer(
  DocCommentDelivery.layer.pipe(
    Layer.provideMerge(DocCommentsService.layer),
    Layer.provideMerge(
      Layer.effectDiscard(runMigrations()).pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
      ),
    ),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(threads),
  ),
);

const anchor = { projectId, quote: "alpha", prefix: "", suffix: "" } as const;

const reset = () => {
  creates.length = 0;
  sent.length = 0;
};

const mappedThread = (parentThreadId: ThreadId, docPath: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM doc_agent_threads
      WHERE parent_thread_id = ${parentThreadId} AND doc_path = ${docPath}
    `;
    return rows[0]?.thread_id ?? null;
  });

layer("DocCommentDelivery", (it) => {
  it.effect("creates the doc agent on first send and reuses it afterwards", () =>
    Effect.gen(function* () {
      reset();
      const delivery = yield* DocCommentDelivery.DocCommentDelivery;
      const docs = yield* DocCommentsService.DocCommentsService;

      const created = yield* delivery.create({
        ...anchor,
        docPath: "specs/send.md",
        body: "Tighten this section",
        sendFromThreadId: conversation,
      });
      const root = created.comment!;

      assert.strictEqual(creates.length, 1);
      const create = creates[0]!;
      const agent = create.threadId;
      assert.notStrictEqual(agent, conversation);
      assert.strictEqual(create.parentThreadId, conversation);
      assert.strictEqual(create.projectId, projectId);
      assert.strictEqual(create.title, "Doc: send");
      assert.deepStrictEqual(create.modelSelection, modelSelection);
      assert.strictEqual(create.runtimeMode, "approval-required");
      assert.strictEqual(create.interactionMode, "plan");
      assert.strictEqual(create.branch, "feature/docs");
      assert.strictEqual(create.worktreePath, "/repo/.worktrees/docs");
      assert.strictEqual(yield* mappedThread(conversation, "specs/send.md"), agent);

      assert.strictEqual(root.sentToThreadId, agent);
      assert.strictEqual(sent.length, 1);
      const first = sent[0]!;
      assert.strictEqual(first.threadId, agent);
      assert.strictEqual(first.projectId, projectId);
      assert.strictEqual(first.mode, "auto");
      assert.strictEqual(first.createdBy, "user");
      assert.isTrue(
        first.text.startsWith("You are the doc agent for specs/send.md in this project."),
      );
      assert.include(first.text, "Doc: specs/send.md");
      assert.include(first.text, `Comment thread: ${root.id}`);
      assert.include(first.text, 'Quoted text: "alpha"');
      assert.include(first.text, "Tighten this section");
      assert.include(first.text, `docs_comment_reply (commentId: ${root.id})`);
      assert.notInclude(first.text, "Earlier in this thread");

      // The agent answers through the persistence service, as its MCP tool does; that never sends.
      yield* docs.reply({
        projectId,
        commentId: root.id,
        body: "Tightened it",
        author: { kind: "agent", threadId: agent },
      });
      const unsent = yield* delivery.reply({ projectId, commentId: root.id, body: "Thanks" });
      assert.strictEqual(sent.length, 1);
      assert.isNull(unsent.comment!.replies.at(-1)!.sentToThreadId);

      const replied = yield* delivery.reply({
        projectId,
        commentId: root.id,
        body: "Shorter still",
        sendFromThreadId: conversation,
      });
      const reply = replied.comment!.replies.at(-1)!;
      assert.strictEqual(creates.length, 1);
      assert.strictEqual(reply.sentToThreadId, agent);
      assert.strictEqual(sent.length, 2);
      assert.strictEqual(sent[1]!.threadId, agent);
      assert.isTrue(sent[1]!.text.startsWith("[Doc comment sent to agent]"));
      assert.include(
        sent[1]!.text,
        `Comment thread: ${root.id}\nQuoted text: "alpha"\n\nShorter still\n\nEarlier in this thread:\n- You: Tighten this section\n- Agent: Tightened it\n- You: Thanks\n`,
      );

      const second = yield* delivery.create({
        ...anchor,
        docPath: "specs/send.md",
        body: "Another note",
        sendFromThreadId: conversation,
      });
      assert.strictEqual(creates.length, 1);
      assert.strictEqual(second.comment!.sentToThreadId, agent);

      const { comments } = yield* docs.list({ projectId, docPath: "specs/send.md" });
      assert.strictEqual(comments[0]!.sentToThreadId, agent);
      assert.strictEqual(comments[0]!.replies.at(-1)!.sentToThreadId, agent);
    }),
  );

  it.effect("keeps one doc agent per conversation and doc", () =>
    Effect.gen(function* () {
      reset();
      const delivery = yield* DocCommentDelivery.DocCommentDelivery;
      const send = (docPath: string, sendFromThreadId: ThreadId) =>
        delivery
          .create({ ...anchor, docPath, body: "Fix", sendFromThreadId })
          .pipe(Effect.map((result) => result.comment!.sentToThreadId));

      const plan = yield* send("plans/a.md", conversation);
      const otherDoc = yield* send("plans/b.md", conversation);
      const otherParent = yield* send("plans/a.md", otherConversation);
      assert.strictEqual(new Set([plan, otherDoc, otherParent]).size, 3);
      assert.deepStrictEqual(
        creates.map((command) => [command.parentThreadId, command.title]),
        [
          [conversation, "Doc: a"],
          [conversation, "Doc: b"],
          [otherConversation, "Doc: a"],
        ],
      );
    }),
  );

  it.effect("creates a single doc agent when sends race", () =>
    Effect.gen(function* () {
      reset();
      const delivery = yield* DocCommentDelivery.DocCommentDelivery;
      const results = yield* Effect.forEach(
        [1, 2, 3],
        (index) =>
          delivery.create({
            ...anchor,
            docPath: "plans/race.md",
            body: `Fix ${index}`,
            sendFromThreadId: conversation,
          }),
        { concurrency: "unbounded" },
      );
      assert.strictEqual(creates.length, 1);
      assert.deepStrictEqual(
        results.map((result) => result.comment!.sentToThreadId),
        [creates[0]!.threadId, creates[0]!.threadId, creates[0]!.threadId],
      );
    }),
  );

  it.effect("replaces an archived or missing doc agent with a fresh one", () =>
    Effect.gen(function* () {
      reset();
      const delivery = yield* DocCommentDelivery.DocCommentDelivery;
      const docPath = "plans/replace.md";
      const send = () =>
        delivery
          .create({ ...anchor, docPath, body: "Fix", sendFromThreadId: conversation })
          .pipe(Effect.map((result) => result.comment!.sentToThreadId!));

      const first = yield* send();
      const now = yield* DateTime.now;
      shells.set(first, { ...shells.get(first)!, archivedAt: now });
      const second = yield* send();
      assert.notStrictEqual(second, first);
      assert.isTrue(sent.at(-1)!.text.startsWith("You are the doc agent"));

      shells.delete(second);
      const third = yield* send();
      assert.notStrictEqual(third, second);
      assert.notStrictEqual(third, first);
      assert.strictEqual(creates.length, 3);
      assert.strictEqual(yield* mappedThread(conversation, docPath), third);
    }),
  );

  it.effect("refuses a conversation outside the comment's project without saving or creating", () =>
    Effect.gen(function* () {
      reset();
      const delivery = yield* DocCommentDelivery.DocCommentDelivery;
      const docs = yield* DocCommentsService.DocCommentsService;
      const docPath = "specs/foreign.md";

      const errors = yield* Effect.forEach(
        [foreignThread, ThreadId.make("thread-missing")],
        (sendFromThreadId) =>
          delivery.create({ ...anchor, docPath, body: "Fix", sendFromThreadId }).pipe(Effect.flip),
      );
      assert.deepStrictEqual(
        errors.map((error) => error.reason),
        ["thread_not_found", "thread_not_found"],
      );
      assert.strictEqual(creates.length, 0);
      assert.strictEqual(sent.length, 0);
      const { comments } = yield* docs.list({ projectId, docPath });
      assert.deepStrictEqual(comments, []);
    }),
  );

  it.effect("keeps the comment unsent when delivery fails", () =>
    Effect.gen(function* () {
      const delivery = yield* DocCommentDelivery.DocCommentDelivery;
      const docs = yield* DocCommentsService.DocCommentsService;
      const docPath = "specs/failed.md";

      const error = yield* delivery
        .create({ ...anchor, docPath, body: "Fix", sendFromThreadId: failingConversation })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "delivery_failed");
      const { comments } = yield* docs.list({ projectId, docPath });
      assert.strictEqual(comments.length, 1);
      assert.isNull(comments[0]!.sentToThreadId);
    }),
  );
});
