import { scopedThreadKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  docsCloudWorkBrief,
  type DocsCloudStartWork,
  type DocsCloudThreadRef,
} from "@t3tools/client-runtime/docs-cloud";
import { EnvironmentId, type ProjectId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { readThreadShell } from "~/state/entities";

import { openDocsCloudInPanel } from "./docsCloud";

/**
 * Threads started from a Docs Cloud doc whose link the doc has not stored yet.
 * A started thread is only a draft until the user sends it, so the Docs panel
 * beside it records the link once the thread exists, then clears it here.
 */
const pendingLinks = new Map<string, string>();

export const pendingDocLink = (threadRef: ScopedThreadRef): string | undefined =>
  pendingLinks.get(scopedThreadKey(threadRef));

export function clearPendingDocLink(threadRef: ScopedThreadRef, docId: string): void {
  const key = scopedThreadKey(threadRef);
  if (pendingLinks.get(key) === docId) pendingLinks.delete(key);
}

export const toThreadRef = (ref: DocsCloudThreadRef): ScopedThreadRef => ({
  environmentId: EnvironmentId.make(ref.environmentId),
  threadId: ThreadId.make(ref.threadId),
});

/** The linked threads this client can open, with their current titles. */
export function openableDocThreads(
  threads: ReadonlyArray<DocsCloudThreadRef>,
): ReadonlyArray<DocsCloudThreadRef & { readonly title: string }> {
  return threads.flatMap((ref) => {
    const shell = readThreadShell(toThreadRef(ref));
    return shell === null ? [] : [{ ...ref, title: shell.title }];
  });
}

/**
 * Opens a new thread in the project with a drafted brief that points at the
 * doc, and the doc beside it. Drafted, not sent: the user reviews the brief
 * before an agent spends a turn on it.
 */
export function useStartWorkFromDoc(
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
): ((work: DocsCloudStartWork, path: string) => Promise<void>) | null {
  const handleNewThread = useNewThreadHandler();
  if (projectId === null) return null;
  return async (work, path) => {
    const opened = await handleNewThread(scopeProjectRef(environmentId, projectId));
    if (!opened) return;
    useComposerDraftStore.getState().setPrompt(opened.draftId, docsCloudWorkBrief(work));
    const threadRef: ScopedThreadRef = { environmentId, threadId: opened.threadId };
    pendingLinks.set(scopedThreadKey(threadRef), work.docId);
    openDocsCloudInPanel(threadRef, path, { maximized: false });
  };
}
