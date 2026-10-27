// @effect-diagnostics nodeBuiltinImport:off - git init has no Effect wrapper in tests.
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceEnvFile from "./WorkspaceEnvFile.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const { mergeEnvFile, formatEnvValue } = WorkspaceEnvFile;

describe("mergeEnvFile", () => {
  it("appends new names and keeps comments and other keys", () => {
    const result = mergeEnvFile("# local dev\nDATABASE_URL=postgres://localhost/dev\n", [
      { name: "OPENAI_API_KEY", value: "sk-proj-abc123" },
    ]);
    expect(result.contents).toBe(
      "# local dev\nDATABASE_URL=postgres://localhost/dev\nOPENAI_API_KEY=sk-proj-abc123\n",
    );
    expect(result.changes).toEqual([{ name: "OPENAI_API_KEY", change: "added" }]);
  });

  it("replaces every assignment of a name and keeps its export prefix", () => {
    const result = mergeEnvFile("export STRIPE_KEY=old\nOTHER=1\nSTRIPE_KEY = older\n", [
      { name: "STRIPE_KEY", value: "sk_test_new" },
    ]);
    expect(result.contents).toBe(
      "export STRIPE_KEY=sk_test_new\nOTHER=1\nSTRIPE_KEY=sk_test_new\n",
    );
    expect(result.changes).toEqual([{ name: "STRIPE_KEY", change: "replaced" }]);
  });

  it("drops the continuation lines of a replaced multi-line value", () => {
    const result = mergeEnvFile('A=1\nPRIVATE_KEY="-----BEGIN\nabc\n-----END"\nB=2\n', [
      { name: "PRIVATE_KEY", value: "new" },
    ]);
    expect(result.contents).toBe("A=1\nPRIVATE_KEY=new\nB=2\n");
  });

  it("creates a file from nothing and preserves CRLF line endings", () => {
    expect(mergeEnvFile("", [{ name: "A", value: "1" }]).contents).toBe("A=1\n");
    expect(mergeEnvFile("X=1\r\nY=2", [{ name: "A", value: "1" }]).contents).toBe(
      "X=1\r\nY=2\r\nA=1\r\n",
    );
  });

  it("uses the last value when a name repeats in one save", () => {
    const result = mergeEnvFile("", [
      { name: "A", value: "first" },
      { name: "A", value: "second" },
    ]);
    expect(result.contents).toBe("A=second\n");
    expect(result.changes).toHaveLength(1);
  });
});

describe("formatEnvValue", () => {
  it("quotes only values a dotenv loader would misread", () => {
    expect(formatEnvValue("sk-proj_ABC.123/+=")).toBe("sk-proj_ABC.123/+=");
    expect(formatEnvValue("has space #hash $HOME")).toBe("'has space #hash $HOME'");
    expect(formatEnvValue("it's\nmulti")).toBe('"it\'s\\nmulti"');
    expect(formatEnvValue('say "hi" it\'s')).toBe('"say \\"hi\\" it\'s"');
  });
});

const UNKNOWN_WORKSPACE_PREFIX = "t3code-unknown-workspace-";
const layerKnownWorkspacesTest = Layer.mock(KnownWorkspaces.KnownWorkspaces)({
  assertContains: (cwd) =>
    cwd.includes(UNKNOWN_WORKSPACE_PREFIX)
      ? Effect.fail(new KnownWorkspaces.UnknownWorkspaceError({ cwd }))
      : Effect.void,
});

const layerTest = WorkspaceEnvFile.layer.pipe(
  Layer.provide(
    WorkspaceFileSystem.layer.pipe(
      Layer.provide(layerKnownWorkspacesTest),
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
    ),
  ),
  Layer.provide(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeGitWorkspace = (prefix: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix });
    NodeChildProcess.execFileSync("git", ["init", "-q"], { cwd });
    return cwd;
  });

it.layer(layerTest, { excludeTestServices: true })("WorkspaceEnvFile", (it) => {
  it.effect("writes keys into .env and reports that git ignores it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const envFile = yield* WorkspaceEnvFile.WorkspaceEnvFile;
      const cwd = yield* makeGitWorkspace("t3code-env-file-");
      yield* fileSystem.writeFileString(path.join(cwd, ".gitignore"), ".env\n");
      yield* fileSystem.writeFileString(path.join(cwd, ".env"), "OPENAI_API_KEY=old\n");

      const result = yield* envFile.setVariables({
        cwd,
        relativePath: ".env",
        variables: [
          { name: "OPENAI_API_KEY", value: "sk-new" },
          { name: "RESEND_API_KEY", value: "re_abc" },
        ],
      });

      expect(result).toEqual({
        relativePath: ".env",
        variables: [
          { name: "OPENAI_API_KEY", change: "replaced" },
          { name: "RESEND_API_KEY", change: "added" },
        ],
        gitIgnored: true,
      });
      expect(yield* fileSystem.readFileString(path.join(cwd, ".env"))).toBe(
        "OPENAI_API_KEY=sk-new\nRESEND_API_KEY=re_abc\n",
      );
    }),
  );

  it.effect("reports a file git would commit", () =>
    Effect.gen(function* () {
      const envFile = yield* WorkspaceEnvFile.WorkspaceEnvFile;
      const cwd = yield* makeGitWorkspace("t3code-env-file-");
      const result = yield* envFile.setVariables({
        cwd,
        relativePath: "apps/web/.env.local",
        variables: [{ name: "A", value: "1" }],
      });
      expect(result.gitIgnored).toBe(false);
    }),
  );

  it.effect("refuses a path outside the workspace without writing it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const envFile = yield* WorkspaceEnvFile.WorkspaceEnvFile;
      const cwd = yield* makeGitWorkspace("t3code-env-file-");
      const error = yield* envFile
        .setVariables({
          cwd: path.join(cwd, "inner"),
          relativePath: "../escaped.env",
          variables: [{ name: "A", value: "1" }],
        })
        .pipe(Effect.flip);
      expect(error.reason).toBe("outside_workspace");
      expect(yield* fileSystem.exists(path.join(cwd, "escaped.env"))).toBe(false);
    }),
  );

  it.effect("refuses a folder the server does not know", () =>
    Effect.gen(function* () {
      const envFile = yield* WorkspaceEnvFile.WorkspaceEnvFile;
      const cwd = yield* makeGitWorkspace(UNKNOWN_WORKSPACE_PREFIX);
      const error = yield* envFile
        .setVariables({ cwd, relativePath: ".env", variables: [{ name: "A", value: "1" }] })
        .pipe(Effect.flip);
      expect(error.reason).toBe("unknown_workspace");
    }),
  );
});
