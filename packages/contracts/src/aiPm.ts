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
export class AiPmError extends Schema.TaggedError<AiPmError>()("AiPmError", {
  reason: Schema.Literals([
    "unavailable",
    "timeout",
    "output_limit",
    "invalid_data",
    "command_failed",
    "project_not_found",
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
    }
  }
}
