import type { EnvironmentId, McpServerListResult, ScopedThreadRef } from "@t3tools/contracts";
import { docsCloudBaseUrl } from "@t3tools/client-runtime/docs-cloud";
import { localDocAppPath } from "@t3tools/shared/docsCloudLocal";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { useRightPanelStore } from "~/rightPanelStore";
import { useEnvironment } from "~/state/environments";
import { useEnvironmentQuerySelector } from "~/state/query";
import { serverEnvironment } from "~/state/server";

/** undefined until the hub list has loaded, so the panel does not flash the setup prompt. */
const selectSetup = (result: AsyncResult.AsyncResult<McpServerListResult, unknown>) =>
  Option.match(AsyncResult.value(result), {
    onNone: () => (AsyncResult.isFailure(result) ? null : undefined),
    onSome: (list) => docsCloudBaseUrl(list.servers),
  });

/**
 * The Docs Cloud origin this environment's MCP hub points at: null when it is
 * not set up, undefined while the hub list is loading.
 */
export function useDocsCloudSetup(environmentId: EnvironmentId | null): string | null | undefined {
  const supported =
    useEnvironment(environmentId)?.serverConfig?.environment.capabilities.mcpServers === true;
  const setup = useEnvironmentQuerySelector(
    supported && environmentId !== null
      ? serverEnvironment.mcpServersLive({ environmentId, input: {} })
      : null,
    selectSetup,
  );
  return supported ? setup : null;
}

/** The Docs Cloud origin this environment's MCP hub points at, or null when it is not set up. */
export function useDocsCloudBaseUrl(environmentId: EnvironmentId | null): string | null {
  return useDocsCloudSetup(environmentId) ?? null;
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

/** Opens one of the project's markdown files, such as `docs/plan.md`, inside Docs Cloud. */
export function openLocalDocInPanel(
  threadRef: ScopedThreadRef,
  docPath: string,
  options: { readonly maximized: boolean },
) {
  openDocsCloudInPanel(threadRef, localDocAppPath(docPath), options);
}
