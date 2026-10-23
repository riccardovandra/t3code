import type { ScopedThreadRef } from "@t3tools/contracts";
import { docsCloudPath } from "@t3tools/client-runtime/docs-cloud";
import type { DocReference, DocsCloudReference } from "@t3tools/shared/toolOutput";
import { CloudIcon, FileTextIcon, Maximize2Icon, PanelRightIcon } from "lucide-react";

import { useRightPanelStore } from "~/rightPanelStore";

import { Button } from "../ui/button";
import { openDocsCloudInPanel, useDocsCloudBaseUrl } from "./docsCloud";

export function openDocInPanel(
  threadRef: ScopedThreadRef,
  docPath: string,
  options: { readonly maximized: boolean },
) {
  const panels = useRightPanelStore.getState();
  panels.open(threadRef, "docs");
  panels.selectDoc(threadRef, docPath);
  if (options.maximized) panels.setMaximized(threadRef, true);
}

/** The doc an agent created or opened, shown in the conversation like a Claude Docs card. */
export function DocTimelineCard(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly doc: DocReference;
}) {
  const { threadRef, doc } = props;
  return (
    <div className="flex max-w-xl flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileTextIcon className="size-4 text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{doc.title}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {doc.docPath}
          </span>
        </span>
        {threadRef ? (
          <span className="flex shrink-0 gap-1">
            <Button
              size="xs"
              variant="outline"
              onClick={() => openDocInPanel(threadRef, doc.docPath, { maximized: false })}
            >
              <PanelRightIcon />
              Open
            </Button>
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Open full screen"
              onClick={() => openDocInPanel(threadRef, doc.docPath, { maximized: true })}
            >
              <Maximize2Icon />
            </Button>
          </span>
        ) : null}
      </div>
      {doc.excerpt ? (
        <p className="line-clamp-3 text-sm text-muted-foreground">{doc.excerpt}</p>
      ) : null}
    </div>
  );
}

/** A doc an agent created in Docs Cloud. Opens beside the chat when it is this environment's Docs Cloud. */
export function DocsCloudTimelineCard(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly doc: DocsCloudReference;
}) {
  const { threadRef, doc } = props;
  const baseUrl = useDocsCloudBaseUrl(threadRef?.environmentId ?? null);
  const path = baseUrl === null ? null : docsCloudPath(doc.url, baseUrl);
  const open = (maximized: boolean) => {
    if (threadRef && path !== null) openDocsCloudInPanel(threadRef, path, { maximized });
    else window.open(doc.url, "_blank", "noopener");
  };
  return (
    <div className="flex max-w-xl items-center gap-3 rounded-xl border border-border bg-card p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <CloudIcon className="size-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{doc.docTitle ?? doc.tabTitle}</span>
        <span className="block truncate text-xs text-muted-foreground">Docs Cloud</span>
      </span>
      <span className="flex shrink-0 gap-1">
        <Button size="xs" variant="outline" onClick={() => open(false)}>
          <PanelRightIcon />
          Open
        </Button>
        {path !== null ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Open full screen"
            onClick={() => open(true)}
          >
            <Maximize2Icon />
          </Button>
        ) : null}
      </span>
    </div>
  );
}
