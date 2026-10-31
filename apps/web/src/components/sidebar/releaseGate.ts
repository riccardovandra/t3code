import type { EnvironmentId } from "@t3tools/contracts";

import type { ServerUpdateTarget } from "../ServerUpdateAction";
import type { SkippedMachine } from "./updateEverything.logic";

/**
 * Where a server's update comes from decides what must be published before it can install it.
 * A release-mirror server (fork: `T3CODE_RELEASE_BASE_URL`) downloads from a mirror, so it waits
 * for the version to land there. Others install as soon as they are asked to.
 */
export type ServerReleaseSource = "desktop-app" | "npm" | "release-mirror";

export function serverReleaseSource(
  server: Pick<ServerUpdateTarget, "environmentId" | "selfUpdate">,
  releaseMirrors: ReadonlySet<EnvironmentId>,
): ServerReleaseSource {
  if (server.selfUpdate === "desktop-managed") return "desktop-app";
  return releaseMirrors.has(server.environmentId) ? "release-mirror" : "npm";
}

export function gateServersOnRelease(input: {
  readonly servers: ReadonlyArray<ServerUpdateTarget>;
  readonly targetVersion: string;
  readonly releaseMirrors: ReadonlySet<EnvironmentId>;
  readonly mirrorPublished: ReadonlySet<EnvironmentId>;
}): { readonly servers: ServerUpdateTarget[]; readonly skipped: SkippedMachine[] } {
  const servers: ServerUpdateTarget[] = [];
  const skipped: SkippedMachine[] = [];
  for (const server of input.servers) {
    const source = serverReleaseSource(server, input.releaseMirrors);
    const reason =
      source === "release-mirror" && !input.mirrorPublished.has(server.environmentId)
        ? `T3 Code ${input.targetVersion} is not on its release mirror yet`
        : null;
    if (reason === null) {
      servers.push(server);
    } else {
      skipped.push({ environmentId: server.environmentId, label: server.serverLabel, reason });
    }
  }
  return { servers, skipped };
}
