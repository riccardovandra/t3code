import { docsCloudBaseUrl } from "@t3tools/client-runtime/docs-cloud";
import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";

/** The Docs Cloud origin this environment's MCP hub points at, or null when it is not set up. */
export function useDocsCloudBaseUrl(environmentId: EnvironmentId | null): string | null {
  const supported =
    useRemoteEnvironmentRuntime(environmentId)?.serverConfig?.environment.capabilities
      .mcpServers === true;
  const servers = useEnvironmentQuery(
    supported && environmentId !== null
      ? serverEnvironment.mcpServersLive({ environmentId, input: {} })
      : null,
  );
  return servers.data ? docsCloudBaseUrl(servers.data.servers) : null;
}
