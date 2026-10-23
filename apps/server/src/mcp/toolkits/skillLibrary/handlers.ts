import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as SkillSources from "../../../skills/SkillSources.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { SkillLibraryToolkit } from "./tools.ts";

/** The calling credential's environment must be this one, as for t3_tools_read. */
const access = Effect.gen(function* () {
  const context = yield* readCaller();
  const environment = yield* Environment.ServerEnvironment;
  const descriptor = yield* environment.getDescriptor;
  if (descriptor.environmentId !== context.scope.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential belongs to another environment.",
    });
  return yield* SkillSources.SkillSources;
});

const sourcesFailure = (error: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

export const layer = McpToolAccess.toLayer(SkillLibraryToolkit, {
  t3_skill_sources_list: McpToolAccess.reads(() =>
    access.pipe(Effect.flatMap((sources) => sources.list.pipe(Effect.mapError(sourcesFailure)))),
  ),
  t3_skill_library_list: McpToolAccess.reads((input) =>
    access.pipe(
      Effect.flatMap((sources) => sources.library(input).pipe(Effect.mapError(sourcesFailure))),
    ),
  ),
});
