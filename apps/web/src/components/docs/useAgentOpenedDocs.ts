import type { OrchestrationV2ProjectedTurnItem, ScopedThreadRef } from "@t3tools/contracts";
import { docOpenFromToolItem } from "@t3tools/shared/toolOutput";
import { useEffect, useRef } from "react";

import { openDocInPanel } from "./DocTimelineCard";

/**
 * Opens the Docs panel when an agent creates or opens a doc during this view,
 * like Claude opening a doc it just drafted. Docs from earlier turns are a
 * baseline, so revisiting a thread never reopens a panel the user closed.
 */
export function useAgentOpenedDocs(
  threadRef: ScopedThreadRef | null,
  visibleTurnItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
) {
  const seen = useRef<{ key: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!threadRef) return;
    const key = `${threadRef.environmentId}:${threadRef.threadId}`;
    const docs = visibleTurnItems.flatMap(({ item }) => {
      if (item.type !== "dynamic_tool" || item.status !== "completed") return [];
      const doc = docOpenFromToolItem(item);
      return doc ? [{ id: item.id, doc }] : [];
    });
    if (seen.current?.key !== key) {
      seen.current = { key, ids: new Set(docs.map((entry) => entry.id)) };
      return;
    }
    const known = seen.current.ids;
    const fresh = docs.filter((entry) => !known.has(entry.id));
    for (const entry of fresh) known.add(entry.id);
    const latest = fresh.at(-1);
    if (latest) openDocInPanel(threadRef, latest.doc.docPath, { maximized: false });
  }, [threadRef, visibleTurnItems]);
}
