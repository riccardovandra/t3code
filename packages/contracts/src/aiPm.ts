import * as Schema from "effect/Schema";

export const AiPmProjectId = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/),
);
const NullableString = Schema.NullOr(Schema.String);
export const AiPmProjectSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  owner: Schema.String,
  area: NullableString,
  now: Schema.String,
  waitingOnYou: Schema.Number,
  done: Schema.Number,
  total: Schema.Number,
  closed: NullableString,
  version: NullableString,
  outcome: NullableString,
});
export type AiPmProjectSummary = typeof AiPmProjectSummary.Type;
export const AiPmListResult = Schema.Struct({
  projects: Schema.Array(AiPmProjectSummary),
  fetchedAt: Schema.String,
});
export type AiPmListResult = typeof AiPmListResult.Type;
export const AiPmBriefInput = Schema.Struct({ projectId: AiPmProjectId });
export const AiPmStep = Schema.Struct({
  ref: Schema.String,
  title: Schema.String,
  what: NullableString,
  owner: Schema.String,
  state: Schema.Literals(["done", "active", "todo", "blocked", "parked", "check"]),
  waitingTitles: Schema.Array(Schema.String),
  lastProgress: NullableString,
  warnings: Schema.Array(Schema.String),
});
export const AiPmBriefResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  owner: Schema.String,
  objective: Schema.String,
  now: Schema.String,
  updated: NullableString,
  done: Schema.Number,
  total: Schema.Number,
  version: NullableString,
  outcome: NullableString,
  shipWhen: NullableString,
  next: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      owner: Schema.String,
      step: NullableString,
      why: NullableString,
    }),
  ),
  risks: Schema.Array(
    Schema.Struct({ code: Schema.String, title: Schema.String, context: NullableString }),
  ),
  phases: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      version: NullableString,
      kind: NullableString,
      shipped: NullableString,
      steps: Schema.Array(AiPmStep),
    }),
  ),
  fetchedAt: Schema.String,
});
export type AiPmBriefResult = typeof AiPmBriefResult.Type;
export const AiPmIdeaId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));
export const AiPmIdeaStatus = Schema.Literals(["parked", "exploring", "promoted", "dropped"]);
export type AiPmIdeaStatus = typeof AiPmIdeaStatus.Type;
const IdeaText = (max: number) => Schema.String.check(Schema.isMaxLength(max));
export const AiPmIdeaThread = Schema.Struct({
  id: IdeaText(200).check(Schema.isMinLength(1)),
  title: Schema.optionalKey(IdeaText(200)),
  // A thread id only resolves in the environment that owns it.
  environment: Schema.optionalKey(IdeaText(200)),
});
export type AiPmIdeaThread = typeof AiPmIdeaThread.Type;
export const AiPmIdeaFile = Schema.Struct({
  path: IdeaText(4_096).check(Schema.isPattern(/^(\/|[A-Za-z]:[\\/])/)),
});
export const AiPmIdea = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: AiPmIdeaStatus,
  summary: Schema.String,
  next: Schema.String,
  project: NullableString,
  threads: Schema.Array(AiPmIdeaThread),
  files: Schema.Array(Schema.Struct({ path: Schema.String })),
  created: Schema.String,
  updated: Schema.String,
});
export type AiPmIdea = typeof AiPmIdea.Type;
export const AiPmIdeasResult = Schema.Struct({
  ideas: Schema.Array(AiPmIdea),
  fetchedAt: Schema.String,
});
export type AiPmIdeasResult = typeof AiPmIdeasResult.Type;
export const AiPmSaveIdeaInput = Schema.Struct({
  id: Schema.optionalKey(AiPmIdeaId),
  title: IdeaText(200).check(Schema.isMinLength(1)),
  summary: IdeaText(8_000),
  next: IdeaText(2_000),
  status: Schema.optionalKey(AiPmIdeaStatus),
  threads: Schema.Array(AiPmIdeaThread).check(Schema.isMaxLength(50)),
  files: Schema.Array(AiPmIdeaFile).check(Schema.isMaxLength(50)),
});
export type AiPmSaveIdeaInput = typeof AiPmSaveIdeaInput.Type;
export const AiPmSetIdeaStatusInput = Schema.Struct({
  id: AiPmIdeaId,
  status: AiPmIdeaStatus,
  // Links a promoted idea to its project; omitted keeps the current link.
  projectId: Schema.optionalKey(Schema.NullOr(AiPmProjectId)),
});
export type AiPmSetIdeaStatusInput = typeof AiPmSetIdeaStatusInput.Type;
export class AiPmError extends Schema.TaggedError<AiPmError>()("AiPmError", {
  reason: Schema.Literals([
    "unavailable",
    "timeout",
    "output_limit",
    "invalid_data",
    "command_failed",
    "project_not_found",
    "idea_not_found",
    "write_failed",
  ]),
}) {
  override get message(): string {
    switch (this.reason) {
      case "unavailable":
        return "AI PM is unavailable. Install aipm on this environment or set T3CODE_AIPM_EXECUTABLE.";
      case "timeout":
        return "AI PM took too long to respond. Try refreshing.";
      case "output_limit":
        return "AI PM returned more data than this view supports.";
      case "invalid_data":
        return "AI PM returned data this version cannot read.";
      case "command_failed":
        return "AI PM could not read the project board.";
      case "project_not_found":
        return "This AI PM project no longer exists. Refresh the project list.";
      case "idea_not_found":
        return "This idea no longer exists. Refresh the ideas list.";
      case "write_failed":
        return "AI PM could not save the idea.";
    }
  }
}
