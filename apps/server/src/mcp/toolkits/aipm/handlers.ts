import { type AiPmError, OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as AiPmService from "../../../aiPm/AiPmService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { AipmToolkit } from "./tools.ts";

const toFailure = (error: AiPmError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "idea_not_found" || error.reason === "project_not_found"
        ? "invalid_request"
        : "orchestration_error",
    message: error.message,
  });

const handlers = {
  aipm_idea_list: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const { ideas } = yield* aiPm.ideas().pipe(Effect.mapError(toFailure));
      return { ideas };
    }),
  ),
  aipm_idea_save: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "aipm_idea_save");
      const threads = yield* ThreadManagementService.ThreadManagementService;
      // Links keep the environment: a thread id opens only in the environment that owns it.
      const link = Effect.fn("mcp.aipm.threadLink")(function* (threadId: ThreadId) {
        const shell = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(unavailable));
        if (shell === null) {
          return yield* new OrchestratorMcpFailure({
            code: "thread_not_found",
            message: `Thread ${threadId} was not found.`,
          });
        }
        return { id: shell.id, title: shell.title.slice(0, 200), environment: scope.environmentId };
      });
      const others = (input.otherThreadIds ?? []).filter((id) => id !== thread.threadId);
      const links = yield* Effect.forEach([thread.threadId, ...new Set(others)], link);
      const aiPm = yield* AiPmService.AiPmService;
      const idea = yield* aiPm
        .saveIdea(
          {
            ...(input.id === undefined ? {} : { id: input.id }),
            title: input.title,
            summary: input.summary,
            next: input.next,
            ...(input.status === undefined ? {} : { status: input.status }),
            threads: links,
            files: (input.files ?? []).map((path) => ({ path })),
          },
          { mergeLinks: true },
        )
        .pipe(Effect.mapError(toFailure));
      return { idea };
    }),
  ),
  aipm_idea_set_status: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const idea = yield* aiPm
        .setIdeaStatus({
          id: input.id,
          status: input.status,
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        })
        .pipe(Effect.mapError(toFailure));
      return { idea };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof AipmToolkit.tools>;

export const layer = McpToolAccess.toLayer(AipmToolkit, handlers);
