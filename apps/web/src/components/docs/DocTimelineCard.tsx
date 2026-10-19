import type { ScopedThreadRef } from "@t3tools/contracts";
import type { DocReference } from "@t3tools/shared/toolOutput";
import { FileTextIcon, Maximize2Icon, PanelRightIcon } from "lucide-react";

import { useRightPanelStore } from "~/rightPanelStore";

import { Button } from "../ui/button";

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
