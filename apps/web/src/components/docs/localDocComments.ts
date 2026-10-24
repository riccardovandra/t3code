import {
  executeAtomQuery,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  DocComment,
  DocCommentCreateInput,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import type { LocalDocComment, LocalDocComments } from "@t3tools/shared/docsCloudLocal";
import type { AtomRegistry } from "effect/reactivity";
import { useEffect, useEffectEvent, useState } from "react";

import type { ReviewCommentContext } from "~/reviewCommentContext";
import { serverEnvironment } from "~/state/server";
import { environmentThreadShells } from "~/state/threads";

import type { LocalDocsContext, LocalDocsHandlers } from "./localDocsBridge";

/** The T3 server's comment RPCs for one environment. */
export interface LocalDocCommentsApi {
  readonly list: (projectId: ProjectId, docPath: string) => Promise<ReadonlyArray<DocComment>>;
  readonly create: (input: DocCommentCreateInput) => Promise<DocComment | null>;
  readonly reply: (input: {
    readonly projectId: ProjectId;
    readonly commentId: string;
    readonly body: string;
    readonly sendFromThreadId?: ThreadId;
  }) => Promise<void>;
  readonly setResolved: (input: {
    readonly projectId: ProjectId;
    readonly commentId: string;
    readonly resolved: boolean;
  }) => Promise<void>;
  readonly delete: (input: {
    readonly projectId: ProjectId;
    readonly commentId: string;
  }) => Promise<void>;
}

export interface LocalCommentsOptions {
  readonly api: LocalDocCommentsApi;
  readonly canComment: boolean;
  /**
   * The conversation whose doc agent a comment can go to, as the old Docs
   * panel's "Send to agent" did; null before the thread exists.
   */
  readonly sendFromThreadId: ThreadId | null;
  readonly addToChat: ((comment: ReviewCommentContext) => void) | null;
  /** Doc agent threads the file's comments went to; their finished turns may answer them. */
  readonly onAgentThreads: (threadIds: ReadonlyArray<ThreadId>) => void;
}

const epoch = (iso: string) => Date.parse(iso);

/**
 * The server keeps a thread as a root with nested replies; the bridge carries
 * them flat. Anchors were always a quote with context on the same visible
 * text the Docs Cloud editor uses, so comments from the old Docs panel anchor
 * unchanged.
 */
function toLocalDocComments(comments: ReadonlyArray<DocComment>): Array<LocalDocComment> {
  return comments.flatMap((root) => [
    {
      id: root.id,
      parentId: null,
      quote: root.quote,
      prefix: root.prefix,
      suffix: root.suffix,
      body: root.body,
      author: root.author.kind,
      resolvedAt: root.resolvedAt === null ? null : epoch(root.resolvedAt),
      createdAt: epoch(root.createdAt),
    },
    ...root.replies.map((reply) => ({
      id: reply.id,
      parentId: root.id,
      quote: "",
      prefix: "",
      suffix: "",
      body: reply.body,
      author: reply.author.kind,
      resolvedAt: null,
      createdAt: epoch(reply.createdAt),
    })),
  ]);
}

function agentThreadIds(comments: ReadonlyArray<DocComment>): Array<ThreadId> {
  return [
    ...new Set(
      comments.flatMap((root) =>
        [root, ...root.replies].flatMap((entry) =>
          entry.sentToThreadId ? [entry.sentToThreadId] : [],
        ),
      ),
    ),
  ];
}

/** A file comment as composer context; the agent answers it with the docs_comment_* tools. */
function buildLocalDocReviewComment(path: string, root: DocComment): ReviewCommentContext {
  return {
    id: `doc-comment-${root.id}`,
    sectionId: `doc:${path}`,
    sectionTitle: `Doc comment ${root.id} (reply with docs_comment_reply)`,
    filePath: path,
    startIndex: 0,
    endIndex: 0,
    rangeLabel: "quoted text",
    text: root.body.trim(),
    diff: root.quote,
    fenceLanguage: "text",
  };
}

/** Comments on the project's files, kept on the T3 server and served to the Docs Cloud frame. */
export function localCommentHandlers(options: LocalCommentsOptions) {
  const { api } = options;

  const listed = async (path: string, context: LocalDocsContext) => {
    const comments = await api.list(context.projectId, path);
    options.onAgentThreads(agentThreadIds(comments));
    return comments;
  };
  const state = async (path: string, context: LocalDocsContext): Promise<LocalDocComments> => ({
    comments: toLocalDocComments(await listed(path, context)),
    canComment: options.canComment,
    canSendToAgent: options.canComment && options.sendFromThreadId !== null,
  });
  const sendFrom = (sendToAgent: boolean) =>
    sendToAgent && options.sendFromThreadId !== null
      ? { sendFromThreadId: options.sendFromThreadId }
      : {};
  const requireCommenting = () => {
    if (!options.canComment) throw new Error("This connection cannot comment on files.");
  };
  // Comment ids are project-wide, so a request must name one on its own file.
  const threadOf = async (path: string, commentId: string, context: LocalDocsContext) => {
    const thread = (await listed(path, context)).find(
      (root) => root.id === commentId || root.replies.some((reply) => reply.id === commentId),
    );
    if (!thread) throw new Error("This comment no longer exists.");
    return thread;
  };
  const mutate = async (
    path: string,
    commentId: string,
    context: LocalDocsContext,
    action: () => Promise<void>,
  ) => {
    requireCommenting();
    await threadOf(path, commentId, context);
    await action();
    return state(path, context);
  };

  return {
    "comments.list": (request, context) => state(request.path, context),
    "comment.create": async (request, context) => {
      requireCommenting();
      const created = await api.create({
        projectId: context.projectId,
        docPath: request.path,
        quote: request.quote,
        prefix: request.prefix,
        suffix: request.suffix,
        body: request.body,
        ...sendFrom(request.sendToAgent),
      });
      if (!created) throw new Error("The comment was not saved.");
      return { ...(await state(request.path, context)), commentId: created.id };
    },
    "comment.reply": (request, context) =>
      mutate(request.path, request.commentId, context, () =>
        api.reply({
          projectId: context.projectId,
          commentId: request.commentId,
          body: request.body,
          ...sendFrom(request.sendToAgent),
        }),
      ),
    "comment.resolve": (request, context) =>
      mutate(request.path, request.commentId, context, () =>
        api.setResolved({
          projectId: context.projectId,
          commentId: request.commentId,
          resolved: request.resolved,
        }),
      ),
    "comment.delete": (request, context) =>
      mutate(request.path, request.commentId, context, () =>
        api.delete({ projectId: context.projectId, commentId: request.commentId }),
      ),
    "comment.chat": async (request, context) => {
      if (!options.addToChat) throw new Error("There is no chat to add this to.");
      const thread = await threadOf(request.path, request.commentId, context);
      options.addToChat(buildLocalDocReviewComment(request.path, thread));
      return { added: true };
    },
  } satisfies LocalDocsHandlers;
}

const QUIET = { reportFailure: false, reportDefect: false } as const;

function valueOf<A>(result: AtomCommandResult<A, unknown>, fallback: string): A {
  if (result._tag === "Success") return result.value;
  const failure = squashAtomCommandFailure(result);
  throw failure instanceof Error && failure.message ? failure : new Error(fallback);
}

/** The comment RPCs over the environment connection, so remote and tunnel work too. */
export function localDocCommentsApi(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
): LocalDocCommentsApi {
  const failed = "Could not update the comment.";
  return {
    list: async (projectId, docPath) => {
      const result = await executeAtomQuery(
        registry,
        serverEnvironment.docComments({ environmentId, input: { projectId, docPath } }),
        { ...QUIET, refresh: true },
      );
      return valueOf(result, "Could not load the comments.").comments;
    },
    create: async (input) =>
      valueOf(
        await runAtomCommand(
          registry,
          serverEnvironment.createDocComment,
          { environmentId, input },
          QUIET,
        ),
        failed,
      ).comment,
    reply: async (input) => {
      valueOf(
        await runAtomCommand(
          registry,
          serverEnvironment.replyDocComment,
          { environmentId, input },
          QUIET,
        ),
        failed,
      );
    },
    setResolved: async (input) => {
      valueOf(
        await runAtomCommand(
          registry,
          serverEnvironment.setDocCommentResolved,
          { environmentId, input },
          QUIET,
        ),
        failed,
      );
    },
    delete: async (input) => {
      valueOf(
        await runAtomCommand(
          registry,
          serverEnvironment.deleteDocComment,
          { environmentId, input },
          QUIET,
        ),
        failed,
      );
    },
  };
}

const latestCompletion = (shell: EnvironmentThreadShell | null) => {
  const run = shell?.latestRun;
  return run?.completedAt ? `${run.runId}:${run.completedAt}` : null;
};

/**
 * Calls `onRunCompleted` whenever one of these doc agent threads finishes a
 * turn. They answer comments with the docs_* MCP tools while they run, so the
 * frame lists the comments again once they are done.
 */
export function useAgentRunCompletions(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  threadIds: ReadonlyArray<ThreadId>,
  onRunCompleted: () => void,
): void {
  const notify = useEffectEvent(onRunCompleted);
  useEffect(() => {
    const stops = threadIds.map((threadId) => {
      const atom = environmentThreadShells.quietThreadShellAtom({ environmentId, threadId });
      let seen = latestCompletion(registry.get(atom));
      return registry.subscribe(atom, (shell) => {
        const next = latestCompletion(shell);
        if (next === seen) return;
        seen = next;
        if (next !== null) notify();
      });
    });
    return () => {
      for (const stop of stops) stop();
    };
  }, [registry, environmentId, threadIds]);
}

/** The doc agent threads seen in comments while the panel is open; the list only changes when one is added. */
export function useAgentThreadIds() {
  const [ids, setIds] = useState<ReadonlyArray<ThreadId>>([]);
  const report = (next: ReadonlyArray<ThreadId>) =>
    setIds((current) =>
      next.every((id) => current.includes(id)) ? current : [...new Set([...current, ...next])],
    );
  return [ids, report] as const;
}
