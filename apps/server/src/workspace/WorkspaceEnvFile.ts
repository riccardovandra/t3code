/**
 * Writes API keys the user enters through /secret into a workspace .env file.
 * Values arrive from the client and go straight to disk; nothing here records
 * them in a thread, a log, or an error.
 */
import {
  ProjectSetEnvVariablesError,
  type ProjectEnvFileFailureReason,
  type ProjectSetEnvVariablesInput,
  type ProjectSetEnvVariablesResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";

type EnvChange = ProjectSetEnvVariablesResult["variables"][number];

const ASSIGNMENT_PATTERN = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;
const BARE_VALUE_PATTERN = /^[A-Za-z0-9_\-.:/+=@,~%^]*$/;

/** Quotes a value so dotenv loaders read it back unchanged. */
export function formatEnvValue(value: string): string {
  if (BARE_VALUE_PATTERN.test(value)) return value;
  // Single quotes are literal in dotenv: no escapes, no ${} expansion.
  if (!value.includes("'") && !/[\r\n]/.test(value)) return `'${value}'`;
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")}"`;
}

/** An opening quote with no close on its line continues onto the following lines. */
function quotedValueEndsOnLine(value: string): boolean {
  const quote = value[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return true;
  for (let index = 1; index < value.length; index++) {
    if (value[index] === "\\" && quote === '"') {
      index++;
      continue;
    }
    if (value[index] === quote) return true;
  }
  return false;
}

/**
 * Replaces every assignment of a given name, keeping `export` prefixes, and
 * appends names the file does not have. Other lines, comments included, are
 * left as they were.
 */
export function mergeEnvFile(
  contents: string,
  variables: ReadonlyArray<{ readonly name: string; readonly value: string }>,
): { readonly contents: string; readonly changes: ReadonlyArray<EnvChange> } {
  const values = new Map(variables.map((variable) => [variable.name, variable.value]));
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents === "" ? [] : contents.split(/\r?\n/);
  const trailingNewline = lines.length > 0 && lines.at(-1) === "";
  if (trailingNewline) lines.pop();

  const replaced = new Set<string>();
  const output: Array<string> = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const match = ASSIGNMENT_PATTERN.exec(line);
    const name = match?.[2];
    if (match === null || name === undefined || !values.has(name)) {
      output.push(line);
      continue;
    }
    output.push(`${match[1]}${name}=${formatEnvValue(values.get(name)!)}`);
    replaced.add(name);
    const oldValue = match[4]!.trimStart();
    if (!quotedValueEndsOnLine(oldValue)) {
      const quote = oldValue[0]!;
      while (index + 1 < lines.length) {
        index++;
        if (lines[index]!.includes(quote)) break;
      }
    }
  }

  const changes: Array<EnvChange> = [];
  for (const [name, value] of values) {
    if (replaced.has(name)) {
      changes.push({ name, change: "replaced" });
    } else {
      output.push(`${name}=${formatEnvValue(value)}`);
      changes.push({ name, change: "added" });
    }
  }
  return { contents: `${output.join(newline)}${newline}`, changes };
}

export class WorkspaceEnvFile extends Context.Service<
  WorkspaceEnvFile,
  {
    readonly setVariables: (
      input: ProjectSetEnvVariablesInput,
    ) => Effect.Effect<ProjectSetEnvVariablesResult, ProjectSetEnvVariablesError>;
  }
>()("t3/workspace/WorkspaceEnvFile") {}

const failureReason = (
  error: { readonly _tag: string; readonly operation?: string },
  stage: "read" | "write",
): ProjectEnvFileFailureReason => {
  switch (error._tag) {
    case "WorkspaceFilePathEscapeError":
    case "WorkspacePathOutsideRootError":
      return "outside_workspace";
    case "UnknownWorkspaceError":
      return "unknown_workspace";
    case "WorkspacePathNotFileError":
      return "not_a_file";
    default:
      return stage === "read" ? "read_failed" : "write_failed";
  }
};

export const make = Effect.gen(function* () {
  const workspaceFiles = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const vcsProcess = yield* VcsProcess.VcsProcess;
  // Read, merge and write must not interleave, or one save drops another's keys.
  const writeLock = yield* Semaphore.make(1);

  const isGitIgnored = (cwd: string, relativePath: string) =>
    vcsProcess
      .run({
        operation: "WorkspaceEnvFile.isGitIgnored",
        command: "git",
        args: ["-c", "core.fsmonitor=false", "check-ignore", "-q", "--", relativePath],
        cwd,
        allowNonZeroExit: true,
        timeoutMs: 10_000,
      })
      .pipe(
        Effect.map((result) =>
          result.exitCode === 0 ? true : result.exitCode === 1 ? false : null,
        ),
        Effect.orElseSucceed(() => null),
      );

  const setVariables: WorkspaceEnvFile["Service"]["setVariables"] = Effect.fn(
    "WorkspaceEnvFile.setVariables",
  )(function* (input) {
    yield* Effect.annotateCurrentSpan({ "env_file.variable_count": input.variables.length });
    const current = yield* workspaceFiles
      .readFile({ cwd: input.cwd, relativePath: input.relativePath, allowMissing: true })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSetEnvVariablesError({ reason: failureReason(cause, "read"), cause }),
        ),
      );
    // A partial read written back would truncate the rest of the file.
    if (current.truncated) {
      return yield* new ProjectSetEnvVariablesError({ reason: "too_large" });
    }
    const merged = mergeEnvFile(current.contents, input.variables);
    const written = yield* workspaceFiles
      .writeFile({ cwd: input.cwd, relativePath: input.relativePath, contents: merged.contents })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSetEnvVariablesError({ reason: failureReason(cause, "write"), cause }),
        ),
      );
    return {
      relativePath: written.relativePath,
      variables: merged.changes,
      gitIgnored: yield* isGitIgnored(input.cwd, written.relativePath),
    };
  }, writeLock.withPermits(1));

  return WorkspaceEnvFile.of({ setVariables });
});

export const layer = Layer.effect(WorkspaceEnvFile, make);
