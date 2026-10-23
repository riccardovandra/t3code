import {
  OrchestratorMcpFailure,
  SkillLibraryListInput,
  SkillLibraryListResult,
  SkillSourcesListResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SkillSources from "../../../skills/SkillSources.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/** Fork: the skill library from saved sources. Installs stay with t3_skills_install. */
const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    SkillSources.SkillSources,
  ],
};

const SkillSourcesListTool = Tool.make("t3_skill_sources_list", {
  ...shared,
  description:
    "List the skill sources saved in Settings → Tools → Library on this environment: id, label and source (GitHub owner/repo, tree URL, git URL or folder).",
  success: SkillSourcesListResult,
})
  .annotate(Tool.Title, "List skill sources")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const SkillLibraryListTool = Tool.make("t3_skill_library_list", {
  ...shared,
  description:
    "List the skills in the saved skill sources (or one, by sourceId): name, description, whether it includes scripts, and where it is installed on this environment (installedAt: environment, or a project's folder). Previews are cached for a few minutes; pass refresh to fetch the sources again. To install one, call t3_skills_install with the source's `source` and the skill's name.",
  parameters: SkillLibraryListInput,
  success: SkillLibraryListResult,
})
  .annotate(Tool.Title, "List the skill library")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const SkillLibraryToolkit = Toolkit.make(SkillSourcesListTool, SkillLibraryListTool);
