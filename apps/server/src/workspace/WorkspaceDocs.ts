/**
 * WorkspaceDocs - the markdown docs in one checkout, as agents see them. Every
 * read and write goes through the workspace file services, so a doc path can
 * never leave the checkout's root.
 *
 * @module WorkspaceDocs
 */
import { docTitleFromPath, isMarkdownPath, nextDocPath } from "@t3tools/shared/docPaths";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

export const WORKSPACE_DOCS_LIST_LIMIT = 200;
// Bounds a walk through a folder that is not really a docs folder.
const MAX_FOLDERS_VISITED = 500;
// Every probe means an existing doc; give up long before this becomes a scan.
const MAX_CREATE_ATTEMPTS = 100;

export class WorkspaceDocsError extends Schema.TaggedError<WorkspaceDocsError>()(
  "WorkspaceDocsError",
  {
    reason: Schema.Literals(["invalid_path", "not_found", "exists", "failed"]),
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
      case "exists":
        return `Could not find a free file name for a doc in '${this.path}'.`;
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
    /** Markdown files under `folder`, recursively, sorted by path. */
    readonly list: (input: {
      readonly cwd: string;
      readonly folder: string;
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
    /** Writes a new doc named after `title`, never overwriting an existing file. */
    readonly create: (input: {
      readonly cwd: string;
      readonly folder: string;
      readonly title: string;
      readonly markdown?: string | undefined;
    }) => Effect.Effect<WorkspaceDoc, WorkspaceDocsError>;
  }
>()("t3/workspace/WorkspaceDocs") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
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

  const list: WorkspaceDocs["Service"]["list"] = Effect.fn("WorkspaceDocs.list")(function* (input) {
    const root = yield* relativeWithinRoot(input.cwd, input.folder);
    const docPaths: Array<string> = [];
    const pending = [root];
    let visited = 0;
    let truncated = false;
    while (pending.length > 0) {
      if (visited++ >= MAX_FOLDERS_VISITED) {
        truncated = true;
        break;
      }
      const directoryPath = pending.shift()!;
      // A missing docs folder simply has no docs yet.
      const listing = yield* entries
        .list({ cwd: input.cwd, directoryPath })
        .pipe(Effect.orElseSucceed(() => ({ entries: [] })));
      for (const entry of listing.entries) {
        if (entry.kind === "directory") pending.push(entry.path);
        else if (isMarkdownPath(entry.path)) docPaths.push(entry.path);
      }
    }
    docPaths.sort();
    if (docPaths.length > WORKSPACE_DOCS_LIST_LIMIT) truncated = true;
    return {
      docs: docPaths
        .slice(0, WORKSPACE_DOCS_LIST_LIMIT)
        .map((docPath) => ({ docPath, title: docTitleFromPath(docPath) })),
      truncated,
    };
  });

  const read: WorkspaceDocs["Service"]["read"] = Effect.fn("WorkspaceDocs.read")(function* (input) {
    // Resolving first keeps an absolute path, which readFile would accept, out.
    const docPath = yield* relativeWithinRoot(input.cwd, input.docPath);
    if (!isMarkdownPath(docPath)) {
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

  const create: WorkspaceDocs["Service"]["create"] = Effect.fn("WorkspaceDocs.create")(
    function* (input) {
      const folder = yield* relativeWithinRoot(input.cwd, input.folder);
      const title = input.title.trim();
      const taken = new Set<string>();
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
        const docPath = nextDocPath(folder, title, taken);
        const { entries: metadata } = yield* files.getMetadata({
          paths: [path.join(input.cwd, docPath)],
        });
        if (metadata[0] != null) {
          taken.add(docPath.toLowerCase());
          continue;
        }
        yield* files
          .writeFile({
            cwd: input.cwd,
            relativePath: docPath,
            contents: input.markdown ?? `# ${title}\n`,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkspaceDocsError({
                  reason:
                    cause._tag === "WorkspaceFileSystemOperationError" ? "failed" : "invalid_path",
                  path: docPath,
                  cause,
                }),
            ),
          );
        return { docPath, title };
      }
      return yield* new WorkspaceDocsError({ reason: "exists", path: folder });
    },
  );

  return WorkspaceDocs.of({ list, read, create });
});

export const layer = Layer.effect(WorkspaceDocs, make);
