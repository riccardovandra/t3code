import {
  localCommentHandlers as sharedLocalCommentHandlers,
  localDocCommentsApi as sharedLocalDocCommentsApi,
  watchRunCompletions,
  type LocalCommentsOptions,
  type LocalDocCommentsApi,
} from "@t3tools/client-runtime/docs-cloud-local-comments";
import type { DocComment, EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { AtomRegistry } from "effect/reactivity";
import { useEffect, useEffectEvent, useState } from "react";

import type { ReviewCommentContext } from "~/reviewCommentContext";
import { serverEnvironment } from "~/state/server";
import { environmentThreadShells } from "~/state/threads";

/** A file comment as composer context; the agent answers it with the docs_comment_* tools. */
function buildLocalDocReviewComment(path: string, root: DocComment): ReviewCommentContext {
  return {
    id: `doc-comment-${root.id}`,
    sectionId: `doc:${path}`,
    sectionTitle: `Doc comment ${root.id} (reply with docs_comment_reply)`,
    filePath: path,
    startIndex: 0,
    endIndex: 0,
    rangeLabel: "quoted text",
    text: root.body.trim(),
    diff: root.quote,
    fenceLanguage: "text",
  };
}

/** Comments on the project's files; "Add to chat" puts a thread in the web composer. */
export function localCommentHandlers(
  options: Omit<LocalCommentsOptions, "addToChat"> & {
    readonly addToChat: ((comment: ReviewCommentContext) => void) | null;
  },
) {
  const { addToChat } = options;
  return sharedLocalCommentHandlers({
    ...options,
    addToChat:
      addToChat === null
        ? null
        : (path, thread) => addToChat(buildLocalDocReviewComment(path, thread)),
  });
}

export function localDocCommentsApi(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
): LocalDocCommentsApi {
  return sharedLocalDocCommentsApi(registry, serverEnvironment, environmentId);
}

/** Calls `onRunCompleted` whenever one of these doc agent threads finishes a turn. */
export function useAgentRunCompletions(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  threadIds: ReadonlyArray<ThreadId>,
  onRunCompleted: () => void,
): void {
  const notify = useEffectEvent(onRunCompleted);
  useEffect(
    () =>
      watchRunCompletions(
        registry,
        (threadId) => environmentThreadShells.quietThreadShellAtom({ environmentId, threadId }),
        threadIds,
        () => notify(),
      ),
    [registry, environmentId, threadIds],
  );
}

/** The doc agent threads seen in comments while the panel is open; the list only changes when one is added. */
export function useAgentThreadIds() {
  const [ids, setIds] = useState<ReadonlyArray<ThreadId>>([]);
  const report = (next: ReadonlyArray<ThreadId>) =>
    setIds((current) =>
      next.every((id) => current.includes(id)) ? current : [...new Set([...current, ...next])],
    );
  return [ids, report] as const;
}
