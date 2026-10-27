import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ThreadStructureVisibleTurnItem } from "@t3tools/client-runtime/state/shell";
import { docsCloudToolEvent } from "@t3tools/client-runtime/docs-cloud";
import { docOpenFromToolItem } from "@t3tools/shared/toolOutput";
import { useEffect, useRef } from "react";

import { toastManager } from "../ui/toast";
import { openDocsCloudInPanel, openLocalDocInPanel, useDocsCloudBaseUrl } from "./docsCloud";

type AgentDocEvent =
  | { readonly kind: "file"; readonly docPath: string }
  | { readonly kind: "doc-created" | "tab-added"; readonly path: string; readonly title: string };

/**
 * Opens the Docs panel when an agent creates or opens a doc during this view,
 * like Claude opening a doc it just drafted, and announces tabs it adds to a
 * Docs Cloud doc. Docs from earlier turns are a baseline, so revisiting a
 * thread never reopens a panel the user closed.
 */
export function useAgentOpenedDocs(
  threadRef: ScopedThreadRef | null,
  visibleTurnItems: ReadonlyArray<ThreadStructureVisibleTurnItem>,
  agentName: string,
) {
  const baseUrl = useDocsCloudBaseUrl(threadRef?.environmentId ?? null);
  const seen = useRef<{ key: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!threadRef) return;
    const key = `${threadRef.environmentId}:${threadRef.threadId}:${baseUrl ?? ""}`;
    const events = visibleTurnItems.flatMap(
      ({ item }): Array<{ id: string; event: AgentDocEvent }> => {
        if (item.type !== "dynamic_tool" || item.status !== "completed") return [];
        const doc = docOpenFromToolItem(item);
        if (doc) return [{ id: item.id, event: { kind: "file", docPath: doc.docPath } }];
        const cloud = baseUrl === null ? null : docsCloudToolEvent(item, baseUrl);
        if (!cloud) return [];
        const title =
          cloud.kind === "doc-created" ? (cloud.ref.docTitle ?? "") : cloud.ref.tabTitle;
        return [{ id: item.id, event: { kind: cloud.kind, path: cloud.path, title } }];
      },
    );
    if (seen.current?.key !== key) {
      seen.current = { key, ids: new Set(events.map((entry) => entry.id)) };
      return;
    }
    const known = seen.current.ids;
    const fresh = events.filter((entry) => !known.has(entry.id));
    for (const entry of fresh) known.add(entry.id);

    for (const { event } of fresh) {
      if (event.kind !== "tab-added") continue;
      const path = event.path;
      const id = toastManager.add({
        type: "info",
        title: `${agentName} added a tab: ${event.title}`,
        actionProps: {
          children: "Open",
          onClick: () => {
            toastManager.close(id);
            openDocsCloudInPanel(threadRef, path, { maximized: false });
          },
        },
      });
    }
    const latest = fresh.findLast((entry) => entry.event.kind !== "tab-added")?.event;
    if (latest?.kind === "file")
      openLocalDocInPanel(threadRef, latest.docPath, { maximized: false });
    else if (latest?.kind === "doc-created") {
      openDocsCloudInPanel(threadRef, latest.path, { maximized: false });
    }
  }, [agentName, baseUrl, threadRef, visibleTurnItems]);
}
