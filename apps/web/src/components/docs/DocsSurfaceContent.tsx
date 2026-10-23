import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { CloudIcon } from "lucide-react";
import { lazy, Suspense } from "react";

import { type RightPanelSurface, useRightPanelStore } from "~/rightPanelStore";

import { Button } from "../ui/button";
import { useDocsCloudBaseUrl } from "./docsCloud";

const DocsPanel = lazy(() =>
  import("./DocsPanel").then((module) => ({ default: module.DocsPanel })),
);
const DocsCloudPanel = lazy(() =>
  import("./DocsCloudPanel").then((module) => ({ default: module.DocsCloudPanel })),
);

/** Docs Cloud when this environment has it set up, otherwise the project's markdown files. */
export function DocsSurfaceContent(props: {
  readonly surface: Extract<RightPanelSurface, { kind: "docs" }>;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly projectId: ProjectId | null;
  readonly workspaceRoot: string | undefined;
}) {
  const { surface, threadRef } = props;
  const baseUrl = useDocsCloudBaseUrl(props.environmentId);
  const hasFiles = props.projectId !== null && props.workspaceRoot !== undefined;
  const panels = useRightPanelStore.getState;

  if (baseUrl !== null && (surface.source !== "files" || !hasFiles)) {
    return (
      <Suspense fallback={null}>
        <DocsCloudPanel
          key={baseUrl}
          baseUrl={baseUrl}
          threadRef={threadRef}
          projectId={props.projectId}
          path={surface.cloudPath}
          onShowFiles={hasFiles ? () => panels().selectDoc(threadRef, surface.docPath) : null}
        />
      </Suspense>
    );
  }
  if (props.projectId === null || props.workspaceRoot === undefined) return null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {baseUrl !== null ? (
        <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            Project files
          </span>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => panels().selectDocsCloud(threadRef, surface.cloudPath)}
          >
            <CloudIcon />
            Docs Cloud
          </Button>
        </div>
      ) : null}
      <Suspense fallback={null}>
        <DocsPanel
          key={`${props.environmentId}:${props.workspaceRoot}`}
          environmentId={props.environmentId}
          projectId={props.projectId}
          cwd={props.workspaceRoot}
          threadRef={threadRef}
          docPath={surface.docPath}
          onSelectDoc={(docPath) => panels().selectDoc(threadRef, docPath)}
        />
      </Suspense>
    </div>
  );
}
