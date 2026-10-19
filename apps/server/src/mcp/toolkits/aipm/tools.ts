import {
  AiPmIdea,
  AiPmIdeaFile,
  AiPmIdeaId,
  AiPmIdeaStatus,
  AiPmProjectId,
  OrchestratorMcpFailure,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as AiPmService from "../../../aiPm/AiPmService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    AiPmService.AiPmService,
  ],
};

const IdeaIdParameter = AiPmIdeaId.annotate({
  description: "The idea's id, as returned by aipm_idea_list or aipm_idea_save.",
});

const AipmIdeaListTool = Tool.make("aipm_idea_list", {
  ...shared,
  description:
    "List the user's AI PM ideas: concepts they started in a chat and parked before they became projects, newest first, with status, where they left off, the next step, and linked threads and files. Check this before saving, to update an existing idea instead of adding a duplicate.",
  success: Schema.Struct({ ideas: Schema.Array(AiPmIdea) }),
})
  .annotate(Tool.Title, "List AI PM ideas")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const AipmIdeaSaveTool = Tool.make("aipm_idea_save", {
  ...shared,
  description:
    'Park an idea in AI PM so the user can pick it up later. Use it when the user says "park this idea" or wants to stop exploring a concept for now. Write the summary as where the work was left (what was explored, decided and built) and the next step as the first thing to do on return. The calling thread is linked automatically. Pass id to update an existing idea; links are added, never removed.',
  parameters: Schema.Struct({
    id: Schema.optional(IdeaIdParameter),
    title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
    summary: Schema.String.check(Schema.isMaxLength(8_000)).annotate({
      description: "Where the work was left: what was explored, decided and produced.",
    }),
    next: Schema.String.check(Schema.isMaxLength(2_000)).annotate({
      description: "The next step when the user picks the idea up again.",
    }),
    status: Schema.optional(
      AiPmIdeaStatus.annotate({ description: 'Defaults to "parked" for a new idea.' }),
    ),
    files: Schema.optional(
      Schema.Array(AiPmIdeaFile.fields.path).check(Schema.isMaxLength(50)).annotate({
        description: "Absolute paths of files or folders produced or used, such as prototypes.",
      }),
    ),
    otherThreadIds: Schema.optional(
      Schema.Array(ThreadId).check(Schema.isMaxLength(20)).annotate({
        description: "Other threads in this environment where the idea was worked on.",
      }),
    ),
  }),
  success: Schema.Struct({ idea: AiPmIdea }),
})
  .annotate(Tool.Title, "Park an idea")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const AipmIdeaSetStatusTool = Tool.make("aipm_idea_set_status", {
  ...shared,
  description:
    "Change an AI PM idea's status: parked, exploring, promoted (to a project) or dropped. Any status can move back to any other. projectId links a promoted idea to its AI PM project.",
  parameters: Schema.Struct({
    id: IdeaIdParameter,
    status: AiPmIdeaStatus,
    projectId: Schema.optional(AiPmProjectId),
  }),
  success: Schema.Struct({ idea: AiPmIdea }),
})
  .annotate(Tool.Title, "Change an idea's status")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const AipmToolkit = Toolkit.make(AipmIdeaListTool, AipmIdeaSaveTool, AipmIdeaSetStatusTool);
