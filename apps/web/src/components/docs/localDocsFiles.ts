import {
  localDocsFiles as sharedLocalDocsFiles,
  type LocalDocsFiles,
} from "@t3tools/client-runtime/docs-cloud-local-host";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { AtomRegistry } from "effect/reactivity";

import { projectEnvironment } from "~/state/projects";
import { serverEnvironment } from "~/state/server";

/** The project's docs through the same RPCs as the rest of the web app. */
export function localDocsFiles(
  registry: AtomRegistry.AtomRegistry,
  scope: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly cwd: string;
  },
): LocalDocsFiles {
  return sharedLocalDocsFiles(
    registry,
    { server: serverEnvironment, projects: projectEnvironment },
    scope,
  );
}
