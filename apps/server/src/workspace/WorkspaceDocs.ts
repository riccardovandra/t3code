/**
 * WorkspaceDocs - the markdown docs in one checkout, as agents see them. Every
 * read and write goes through the workspace file services, so a doc path can
 * never leave the checkout's root.
 *
 * @module WorkspaceDocs
 */
import { docTitleFromPath, isProjectDocPath } from "@t3tools/shared/docPaths";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const WORKSPACE_DOCS_LIST_LIMIT = 1_000;

export class WorkspaceDocsError extends Schema.TaggedError<WorkspaceDocsError>()(
  "WorkspaceDocsError",
  {
    reason: Schema.Literals(["invalid_path", "not_found", "failed"]),
    path: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "invalid_path":
        return `'${this.path}' is not a path inside the project.`;
      case "not_found":
        return `No doc exists at '${this.path}'.`;
      case "failed":
        return `The doc at '${this.path}' could not be accessed.`;
    }
  }
}

export interface WorkspaceDoc {
  readonly docPath: string;
  readonly title: string;
}

export class WorkspaceDocs extends Context.Service<
  WorkspaceDocs,
  {
    /**
     * Project markdown files under `folder` (the whole checkout when omitted),
     * recursively, sorted by path, without gitignored files or skipped folders.
     */
    readonly list: (input: {
      readonly cwd: string;
      readonly folder?: string;
    }) => Effect.Effect<
      { readonly docs: ReadonlyArray<WorkspaceDoc>; readonly truncated: boolean },
      WorkspaceDocsError
    >;
    readonly read: (input: {
      readonly cwd: string;
      readonly docPath: string;
    }) => Effect.Effect<
      WorkspaceDoc & { readonly markdown: string; readonly truncated: boolean },
      WorkspaceDocsError
    >;
  }
>()("t3/workspace/WorkspaceDocs") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const entries = yield* WorkspaceEntries.WorkspaceEntries;
  const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;

  const relativeWithinRoot = (cwd: string, requested: string) =>
    workspacePaths
      .resolveRelativePathWithinRoot({ workspaceRoot: cwd, relativePath: requested })
      .pipe(
        Effect.map((target) => target.relativePath),
        Effect.mapError(
          (cause) => new WorkspaceDocsError({ reason: "invalid_path", path: requested, cause }),
        ),
      );

  // The workspace path index already honours .gitignore and is refreshed by
  // file writes, so one lookup replaces a folder-by-folder walk.
  const list: WorkspaceDocs["Service"]["list"] = Effect.fn("WorkspaceDocs.list")(function* (input) {
    const folder = input.folder ? yield* relativeWithinRoot(input.cwd, input.folder) : "";
    const listing = yield* entries
      .list({ cwd: input.cwd })
      .pipe(
        Effect.mapError(
          (cause) => new WorkspaceDocsError({ reason: "failed", path: folder, cause }),
        ),
      );
    const docPaths = listing.entries
      .filter(
        (entry) =>
          entry.kind === "file" &&
          (folder === "" || entry.path.startsWith(`${folder}/`)) &&
          isProjectDocPath(entry.path),
      )
      .map((entry) => entry.path)
      .toSorted();
    return {
      docs: docPaths
        .slice(0, WORKSPACE_DOCS_LIST_LIMIT)
        .map((docPath) => ({ docPath, title: docTitleFromPath(docPath) })),
      truncated: listing.truncated || docPaths.length > WORKSPACE_DOCS_LIST_LIMIT,
    };
  });

  const read: WorkspaceDocs["Service"]["read"] = Effect.fn("WorkspaceDocs.read")(function* (input) {
    // Resolving first keeps an absolute path, which readFile would accept, out.
    const docPath = yield* relativeWithinRoot(input.cwd, input.docPath);
    if (!isProjectDocPath(docPath)) {
      return yield* new WorkspaceDocsError({ reason: "invalid_path", path: input.docPath });
    }
    const file = yield* files.readFile({ cwd: input.cwd, relativePath: docPath }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceDocsError({
            reason:
              cause._tag === "WorkspaceFileSystemOperationError" &&
              cause.operation === "realpath-target"
                ? "not_found"
                : cause._tag === "WorkspaceFileSystemOperationError"
                  ? "failed"
                  : "invalid_path",
            path: docPath,
            cause,
          }),
      ),
    );
    return {
      docPath,
      title: docTitleFromPath(docPath),
      markdown: file.contents,
      truncated: file.truncated,
    };
  });

  return WorkspaceDocs.of({ list, read });
});

export const layer = Layer.effect(WorkspaceDocs, make);
