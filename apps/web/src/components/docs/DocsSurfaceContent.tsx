import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import type { DraftId } from "~/composerDraftStore";
import type { RightPanelSurface } from "~/rightPanelStore";
import { serverEnvironment } from "~/state/server";

import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { useDocsCloudSetup } from "./docsCloud";

const DocsCloudPanel = lazy(() =>
  import("./DocsCloudPanel").then((module) => ({ default: module.DocsCloudPanel })),
);

/** Docs Cloud, with the project's markdown files inside it, or how to connect it. */
export function DocsSurfaceContent(props: {
  readonly surface: Extract<RightPanelSurface, { kind: "docs" }>;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly projectId: ProjectId | null;
  readonly workspaceRoot: string | undefined;
}) {
  const baseUrl = useDocsCloudSetup(props.environmentId);
  if (baseUrl === undefined) return null;
  if (baseUrl === null) return <ConnectDocsCloud environmentId={props.environmentId} />;
  return (
    <Suspense fallback={null}>
      <DocsCloudPanel
        key={baseUrl}
        baseUrl={baseUrl}
        threadRef={props.threadRef}
        composerDraftTarget={props.composerDraftTarget}
        projectId={props.projectId}
        workspaceRoot={props.workspaceRoot}
        path={props.surface.cloudPath}
      />
    </Suspense>
  );
}

function ConnectDocsCloud(props: { readonly environmentId: EnvironmentId }) {
  const canConnect = useAtomValue(
    serverEnvironment.upsertMcpServer.permissionAtom(props.environmentId),
  );
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>Connect Docs Cloud</EmptyTitle>
        <EmptyDescription>
          {canConnect
            ? "Docs opens in Docs Cloud, with this project's markdown files beside your docs. Connect it to read, edit and comment on them here."
            : "Docs opens in Docs Cloud, which this environment has not connected. Ask its owner to connect it in Settings."}
        </EmptyDescription>
      </EmptyHeader>
      {canConnect ? (
        <EmptyContent>
          <Button
            size="sm"
            render={
              <Link
                to="/settings/mcp-servers"
                search={{ machine: props.environmentId }}
                hash="docs-cloud"
              />
            }
          >
            Open MCP servers settings
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
