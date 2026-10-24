import type {
  DocComment,
  DocCommentCreateInput,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import type { LocalDocComment, LocalDocComments } from "@t3tools/shared/docsCloudLocal";
import type { Atom, AtomRegistry } from "effect/reactivity";

import {
  localDocsValueOf,
  type LocalDocsContext,
  type LocalDocsHandlers,
} from "./docsCloudLocalHost.ts";
import type { EnvironmentThreadShell } from "./state/models.ts";
import { executeAtomQuery, runAtomCommand } from "./state/runtime.ts";
import type { createServerEnvironmentAtoms } from "./state/server.ts";

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
  /** Puts a file's comment thread in the conversation's composer; null where the client has none. */
  readonly addToChat: ((path: string, thread: DocComment) => void) | null;
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
      options.addToChat(request.path, thread);
      return { added: true };
    },
  } satisfies LocalDocsHandlers;
}

const QUIET = { reportFailure: false, reportDefect: false } as const;

type CommentAtoms = Pick<
  ReturnType<typeof createServerEnvironmentAtoms>,
  | "docComments"
  | "createDocComment"
  | "replyDocComment"
  | "setDocCommentResolved"
  | "deleteDocComment"
>;

/** The comment RPCs over the environment connection, so remote and tunnel work too. */
export function localDocCommentsApi(
  registry: AtomRegistry.AtomRegistry,
  server: CommentAtoms,
  environmentId: EnvironmentId,
): LocalDocCommentsApi {
  const failed = "Could not update the comment.";
  return {
    list: async (projectId, docPath) => {
      const result = await executeAtomQuery(
        registry,
        server.docComments({ environmentId, input: { projectId, docPath } }),
        { ...QUIET, refresh: true },
      );
      return localDocsValueOf(result, "Could not load the comments.").comments;
    },
    create: async (input) =>
      localDocsValueOf(
        await runAtomCommand(registry, server.createDocComment, { environmentId, input }, QUIET),
        failed,
      ).comment,
    reply: async (input) => {
      localDocsValueOf(
        await runAtomCommand(registry, server.replyDocComment, { environmentId, input }, QUIET),
        failed,
      );
    },
    setResolved: async (input) => {
      localDocsValueOf(
        await runAtomCommand(
          registry,
          server.setDocCommentResolved,
          { environmentId, input },
          QUIET,
        ),
        failed,
      );
    },
    delete: async (input) => {
      localDocsValueOf(
        await runAtomCommand(registry, server.deleteDocComment, { environmentId, input }, QUIET),
        failed,
      );
    },
  };
}

/** Changes whenever the thread's latest run finishes; null while none has. */
export function latestRunCompletion(
  shell: Pick<EnvironmentThreadShell, "latestRun"> | null | undefined,
): string | null {
  const run = shell?.latestRun;
  return run?.completedAt ? `${run.runId}:${run.completedAt}` : null;
}

/**
 * Calls `onRunCompleted` whenever one of these threads finishes a turn. Doc
 * agent threads answer comments with the docs_* MCP tools while they run, so
 * the frame lists the comments again once they are done. Returns the stop.
 */
export function watchRunCompletions(
  registry: AtomRegistry.AtomRegistry,
  shellAtom: (threadId: ThreadId) => Atom.Atom<EnvironmentThreadShell | null>,
  threadIds: ReadonlyArray<ThreadId>,
  onRunCompleted: () => void,
): () => void {
  const stops = threadIds.map((threadId) => {
    const atom = shellAtom(threadId);
    let seen = latestRunCompletion(registry.get(atom));
    return registry.subscribe(atom, (shell) => {
      const next = latestRunCompletion(shell);
      if (next === seen) return;
      seen = next;
      if (next !== null) onRunCompleted();
    });
  });
  return () => {
    for (const stop of stops) stop();
  };
}
