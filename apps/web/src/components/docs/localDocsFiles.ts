import {
  executeAtomQuery,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { AtomRegistry } from "effect/reactivity";

import { projectEnvironment } from "~/state/projects";
import { serverEnvironment } from "~/state/server";

import { getProjectFileQueryAtom } from "../files/projectFilesQueryState";
import type { LocalDocsFiles } from "./localDocsBridge";

const QUIET = { reportFailure: false, reportDefect: false } as const;

function valueOf<A>(result: AtomCommandResult<A, unknown>, fallback: string): A {
  if (result._tag === "Success") return result.value;
  const failure = squashAtomCommandFailure(result);
  throw failure instanceof Error && failure.message ? failure : new Error(fallback);
}

/** The project's docs through the same RPCs as the Docs panel, so remote and tunnel work too. */
export function localDocsFiles(
  registry: AtomRegistry.AtomRegistry,
  scope: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly cwd: string;
  },
): LocalDocsFiles {
  const { environmentId, projectId, cwd } = scope;
  return {
    list: async () => {
      const result = await executeAtomQuery(
        registry,
        serverEnvironment.docsCloudImports({ environmentId, input: { projectId, cwd } }),
        { ...QUIET, refresh: true },
      );
      return valueOf(result, "Could not list the project's docs.").docs.map((doc) => ({
        path: doc.docPath,
        title: doc.title,
      }));
    },
    read: async (path) => {
      const result = await executeAtomQuery(
        registry,
        getProjectFileQueryAtom(environmentId, cwd, path),
        { ...QUIET, refresh: true },
      );
      const { contents, truncated } = valueOf(result, "Could not read the file.");
      return { contents, truncated };
    },
    write: async (path, contents) => {
      const result = await runAtomCommand(
        registry,
        projectEnvironment.writeFile,
        { environmentId, input: { cwd, relativePath: path, contents } },
        QUIET,
      );
      valueOf(result, "Could not save the file.");
      // Other views of the file (the file preview, the old Docs panel) catch up.
      registry.refresh(getProjectFileQueryAtom(environmentId, cwd, path));
    },
  };
}
