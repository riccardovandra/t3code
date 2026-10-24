import {
  type DocComment,
  type DocsCloudError,
  type DocsError,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import { DOCS_ROOT, docExcerpt } from "@t3tools/shared/docPaths";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as DocCommentsService from "../../../docs/DocCommentsService.ts";
import * as DocsCloudImport from "../../../docs/DocsCloudImport.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as WorkspaceDocs from "../../../workspace/WorkspaceDocs.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { DocsToolkit } from "./tools.ts";

const toFailure = (error: DocsError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "comment_not_found" ? "invalid_request" : "orchestration_error",
    message: error.message,
  });

// Doc comments belong to the calling thread's project; agents never name a
// project, so they cannot reach another project's comments.
const callerContext = Effect.fn("mcp.docs.callerContext")(function* (operation: string) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, operation);
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const shell = yield* threads.getThreadShell(thread.threadId).pipe(Effect.mapError(unavailable));
  if (shell === null) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_not_found",
      message: "The calling thread was not found.",
    });
  }
  return {
    projectId: shell.projectId,
    worktreePath: shell.worktreePath,
    author: { kind: "agent", threadId: thread.threadId } as const,
    docs: yield* DocCommentsService.DocCommentsService,
  };
});

const toFileFailure = (error: WorkspaceDocs.WorkspaceDocsError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "failed" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

// Doc files live in the caller's checkout: its worktree, else the project root.
const callerCheckout = Effect.fn("mcp.docs.callerCheckout")(function* (operation: string) {
  const context = yield* callerContext(operation);
  if (context.worktreePath !== null) return { ...context, cwd: context.worktreePath };
  const projects = yield* ProjectService.ProjectService;
  const project = yield* projects.getById(context.projectId).pipe(Effect.mapError(unavailable));
  if (Option.isNone(project)) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "The calling thread's project was not found.",
    });
  }
  return { ...context, cwd: project.value.workspaceRoot };
});

const toCloudFailure = (error: DocsCloudError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "not_configured" ? "invalid_request" : "orchestration_error",
    message: error.message,
  });

const openComments = (comments: ReadonlyArray<DocComment>) =>
  comments.filter((comment) => comment.resolvedAt === null);

const handlers = {
  docs_list: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId, cwd, docs } = yield* callerCheckout("docs_list");
      const files = yield* WorkspaceDocs.WorkspaceDocs;
      const listed = yield* files
        .list({ cwd, folder: input.folder ?? DOCS_ROOT })
        .pipe(Effect.mapError(toFileFailure));
      const comments = yield* docs
        .listForProject({ projectId, includeResolved: false })
        .pipe(Effect.mapError(toFailure));
      const counts = new Map<string, number>();
      for (const comment of comments) {
        counts.set(comment.docPath, (counts.get(comment.docPath) ?? 0) + 1);
      }
      return {
        docs: listed.docs.map((doc) => ({ ...doc, openComments: counts.get(doc.docPath) ?? 0 })),
        truncated: listed.truncated,
      };
    }),
  ),
  docs_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId, cwd, docs } = yield* callerCheckout("docs_read");
      const files = yield* WorkspaceDocs.WorkspaceDocs;
      const doc = yield* files
        .read({ cwd, docPath: input.docPath })
        .pipe(Effect.mapError(toFileFailure));
      const { comments } = yield* docs
        .list({ projectId, docPath: doc.docPath })
        .pipe(Effect.mapError(toFailure));
      return {
        ...doc,
        ...(doc.truncated
          ? {
              message:
                "The doc is larger than the read limit, so markdown holds only its beginning. Read the rest of the file with your file tools.",
            }
          : {}),
        comments: openComments(comments),
      };
    }),
  ),
  docs_open: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { cwd } = yield* callerCheckout("docs_open");
      const files = yield* WorkspaceDocs.WorkspaceDocs;
      const { docPath, title, markdown } = yield* files
        .read({ cwd, docPath: input.docPath })
        .pipe(Effect.mapError(toFileFailure));
      return { doc: { docPath, title, excerpt: docExcerpt(markdown) } };
    }),
  ),
  docs_list_comments: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId, docs } = yield* callerContext("docs_list_comments");
      const includeResolved = input.includeResolved ?? false;
      if (input.docPath === undefined) {
        const comments = yield* docs
          .listForProject({ projectId, includeResolved })
          .pipe(Effect.mapError(toFailure));
        return { comments };
      }
      const { comments } = yield* docs
        .list({ projectId, docPath: input.docPath })
        .pipe(Effect.mapError(toFailure));
      return { comments: includeResolved ? comments : openComments(comments) };
    }),
  ),
  docs_comment_create: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId, author, docs } = yield* callerContext("docs_comment_create");
      return yield* docs
        .create({ ...input, projectId, prefix: "", suffix: "", author })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  docs_comment_reply: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId, author, docs } = yield* callerContext("docs_comment_reply");
      return yield* docs.reply({ ...input, projectId, author }).pipe(Effect.mapError(toFailure));
    }),
  ),
  docs_comment_resolve: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId, docs } = yield* callerContext("docs_comment_resolve");
      return yield* docs
        .setResolved({ projectId, commentId: input.commentId, resolved: input.resolved ?? true })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  docs_cloud_project: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const { projectId } = yield* callerContext("docs_cloud_project");
      const cloud = yield* DocsCloudImport.DocsCloudImport;
      const project = yield* cloud.project({ projectId }).pipe(Effect.mapError(toCloudFailure));
      return { project };
    }),
  ),
  docs_cloud_import: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { projectId, cwd } = yield* callerCheckout("docs_cloud_import");
      const cloud = yield* DocsCloudImport.DocsCloudImport;
      return yield* cloud
        .importDocs({
          projectId,
          cwd,
          ...(input.docPaths ? { docPaths: input.docPaths } : {}),
          ...(input.update !== undefined ? { update: input.update } : {}),
        })
        .pipe(Effect.mapError(toCloudFailure));
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof DocsToolkit.tools>;

export const layer = McpToolAccess.toLayer(DocsToolkit, handlers);
