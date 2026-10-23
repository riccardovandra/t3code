import {
  OrchestratorMcpFailure,
  SkillTrashEntryId,
  SkillTrashListResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SkillLibrary from "../../../skills/SkillLibrary.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    ThreadCommandExecutor.ThreadCommandExecutor,
    SkillLibrary.SkillLibrary,
  ],
};

const SkillsTrashListTool = Tool.make("t3_skills_trash_list", {
  ...shared,
  description:
    "List the skills t3_skills_remove or the Tools page moved to this environment's trash, newest first: name, where it was (environment or project folder), when, and its original paths. Restore one with t3_skills_restore.",
  success: SkillTrashListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const SkillsRestoreTool = Tool.make("t3_skills_restore", {
  ...shared,
  description:
    "Put a skill from the trash back exactly where it was, with its agent links and its lock entry, by its id from t3_skills_trash_list. Refuses when something now occupies one of its original paths. Requires a live full-access/default calling thread.",
  parameters: Schema.Struct({ id: SkillTrashEntryId }),
  success: Schema.Struct({}),
}).annotate(Tool.Destructive, false);

export const SkillTrashToolkit = Toolkit.make(SkillsTrashListTool, SkillsRestoreTool);
