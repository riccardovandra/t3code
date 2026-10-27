import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";
import * as WorkspaceDocs from "./WorkspaceDocs.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const layerTest = WorkspaceDocs.layer.pipe(
  Layer.provideMerge(
    WorkspaceFileSystem.layer.pipe(
      Layer.provide(
        Layer.mock(KnownWorkspaces.KnownWorkspaces)({ assertContains: () => Effect.void }),
      ),
    ),
  ),
  Layer.provideMerge(WorkspaceEntries.layer),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-workspace-docs-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const makeRepo = Effect.fn("makeRepo")(function* (files: Record<string, string>) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-workspace-docs-" });
  const vcs = yield* VcsProcess.VcsProcess;
  yield* vcs.run({
    operation: "WorkspaceDocs.test.git",
    command: "git",
    cwd: root,
    args: ["init"],
  });
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
    yield* fileSystem.writeFileString(absolutePath, contents);
  }
  return root;
});

it.layer(layerTest, { excludeTestServices: true })("WorkspaceDocs", (it) => {
  describe("list", () => {
    it.effect("lists every project markdown file, skipping ignored and tool folders", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = yield* makeRepo({
            ".gitignore": "build/\nsecret.md\n",
            "README.md": "# Readme\n",
            "docs/plan.md": "# Plan\n",
            "apps/web/README.md": "# Web\n",
            "apps/web/index.ts": "export {};\n",
            "build/out.md": "# Built\n",
            "secret.md": "# Secret\n",
            ".repos/effect/README.md": "# Vendored\n",
            ".plans/next.md": "# Plan\n",
            ".t3/notes.md": "# Notes\n",
            "packages/x/node_modules/dep/README.md": "# Dep\n",
          });
          const docs = yield* WorkspaceDocs.WorkspaceDocs;

          const all = yield* docs.list({ cwd });
          expect(all.docs.map((doc) => doc.docPath)).toEqual([
            "README.md",
            "apps/web/README.md",
            "docs/plan.md",
          ]);
          expect(all.truncated).toBe(false);

          const inDocs = yield* docs.list({ cwd, folder: "docs" });
          expect(inDocs.docs).toEqual([{ docPath: "docs/plan.md", title: "plan" }]);
          expect((yield* docs.list({ cwd, folder: "missing" })).docs).toEqual([]);
        }),
      ),
    );
  });

  describe("read", () => {
    it.effect("reads project markdown and refuses skipped folders", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = yield* makeRepo({
            "README.md": "# Readme\n",
            ".repos/effect/README.md": "# Vendored\n",
          });
          const docs = yield* WorkspaceDocs.WorkspaceDocs;

          expect((yield* docs.read({ cwd, docPath: "README.md" })).markdown).toBe("# Readme\n");
          const refused = yield* docs
            .read({ cwd, docPath: ".repos/effect/README.md" })
            .pipe(Effect.flip);
          expect(refused.reason).toBe("invalid_path");
        }),
      ),
    );
  });
});
