import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as SkillLibrary from "../../../skills/SkillLibrary.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { SkillTrashToolkit } from "./tools.ts";

const sameEnvironment = Effect.gen(function* () {
  const context = yield* readCaller();
  const descriptor = yield* (yield* Environment.ServerEnvironment).getDescriptor;
  if (descriptor.environmentId !== context.scope.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential belongs to another environment.",
    });
});

const trashFailure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

export const layer = McpToolAccess.toLayer(SkillTrashToolkit, {
  t3_skills_trash_list: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      yield* sameEnvironment;
      return yield* (yield* SkillLibrary.SkillLibrary).listTrash;
    }),
  ),
  // Same gate as t3_skills_remove: restored skills carry scripts agents can run.
  t3_skills_restore: McpToolAccess.writesEnvironment((input, check) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const library = yield* SkillLibrary.SkillLibrary;
      const restore = check.pipe(
        Effect.andThen(sameEnvironment),
        Effect.andThen(library.restoreFromTrash({ id: input.id })),
        Effect.mapError((error) =>
          error._tag === "SkillTrashError" ? trashFailure(error) : error,
        ),
        Effect.as({}),
      );
      return yield* scope.thread === undefined
        ? restore
        : executor.withLock(scope.thread.threadId, restore);
    }),
  ),
});
