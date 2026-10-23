import type { EnvironmentId, McpServerListResult, ScopedThreadRef } from "@t3tools/contracts";
import { docsCloudConfig } from "@t3tools/client-runtime/docs-cloud";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { useRightPanelStore } from "~/rightPanelStore";
import { useEnvironment } from "~/state/environments";
import { useEnvironmentQuerySelector } from "~/state/query";
import { serverEnvironment } from "~/state/server";

const selectBaseUrl = (result: AsyncResult.AsyncResult<McpServerListResult, unknown>) =>
  Option.match(AsyncResult.value(result), {
    onNone: () => null,
    onSome: (list) => docsCloudConfig(list.servers)?.baseUrl ?? null,
  });

/** The Docs Cloud origin this environment's MCP hub points at, or null when it is not set up. */
export function useDocsCloudBaseUrl(environmentId: EnvironmentId | null): string | null {
  const supported =
    useEnvironment(environmentId)?.serverConfig?.environment.capabilities.mcpServers === true;
  return useEnvironmentQuerySelector(
    supported && environmentId !== null
      ? serverEnvironment.mcpServersLive({ environmentId, input: {} })
      : null,
    selectBaseUrl,
  );
}

export function openDocsCloudInPanel(
  threadRef: ScopedThreadRef,
  path: string,
  options: { readonly maximized: boolean },
) {
  const panels = useRightPanelStore.getState();
  panels.open(threadRef, "docs");
  panels.selectDocsCloud(threadRef, path);
  if (options.maximized) panels.setMaximized(threadRef, true);
}
