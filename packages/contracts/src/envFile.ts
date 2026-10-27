import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** The names shells and dotenv loaders accept without quoting. */
export const ENV_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const ENV_VARIABLES_MAX_PER_WRITE = 50;

export const EnvVariableName = Schema.String.check(
  Schema.isPattern(ENV_VARIABLE_NAME_PATTERN),
  Schema.isMaxLength(128),
);
export type EnvVariableName = typeof EnvVariableName.Type;

/**
 * The user types values straight into the server's file; they never reach a
 * thread, so the agent learns only the names.
 */
export const ProjectSetEnvVariablesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  variables: Schema.Array(
    Schema.Struct({
      name: EnvVariableName,
      value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16_384)),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(ENV_VARIABLES_MAX_PER_WRITE)),
});
export type ProjectSetEnvVariablesInput = typeof ProjectSetEnvVariablesInput.Type;

export const ProjectSetEnvVariablesResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  variables: Schema.Array(
    Schema.Struct({
      name: EnvVariableName,
      change: Schema.Literals(["added", "replaced"]),
    }),
  ),
  /** null when the folder is not a git repository. */
  gitIgnored: Schema.NullOr(Schema.Boolean),
});
export type ProjectSetEnvVariablesResult = typeof ProjectSetEnvVariablesResult.Type;

const PROJECT_ENV_FILE_FAILURE_MESSAGES = {
  outside_workspace: "That file is outside this thread's workspace.",
  unknown_workspace: "This folder is not a workspace on the server.",
  not_a_file: "That path is a folder, not a file.",
  too_large: "That file is too large to update safely.",
  read_failed: "Could not read the file.",
  write_failed: "Could not write the file.",
} as const;

export const ProjectEnvFileFailureReason = Schema.Literals(
  Object.keys(PROJECT_ENV_FILE_FAILURE_MESSAGES) as Array<
    keyof typeof PROJECT_ENV_FILE_FAILURE_MESSAGES
  >,
);
export type ProjectEnvFileFailureReason = typeof ProjectEnvFileFailureReason.Type;

export class ProjectSetEnvVariablesError extends Schema.TaggedError<ProjectSetEnvVariablesError>()(
  "ProjectSetEnvVariablesError",
  {
    reason: ProjectEnvFileFailureReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return PROJECT_ENV_FILE_FAILURE_MESSAGES[this.reason];
  }
}
