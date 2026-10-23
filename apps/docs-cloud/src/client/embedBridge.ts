import { useSyncExternalStore } from "react";

import {
  EMBED_ORIGINS_META,
  isAllowedEmbedOrigin,
  parseParentMessage,
  type EmbedFeature,
  type EmbedFrameMessage,
  type EmbedParentMessage,
} from "../shared/embed.ts";
import { isAgentAuthor } from "../shared/threads.ts";
import { api } from "./api.ts";
import { setSendToAgentHandler } from "./comments/sendToAgent.ts";
import { navigate, parseRoute, subscribePathname } from "./router.ts";

let parentOrigin: string | null = null;
/** What the embedding T3 Code offers; null outside T3 Code or before its hello. */
let features: ReadonlyArray<EmbedFeature> | null = null;
const featureListeners = new Set<() => void>();
const messageListeners = new Set<(message: EmbedParentMessage) => void>();
let removeSendToAgent: (() => void) | null = null;

/** Sends to T3 Code; a no-op until it has said hello. */
export function postToParent(message: EmbedFrameMessage): void {
  if (parentOrigin) window.parent.postMessage(message, parentOrigin);
}

const subscribeFeatures = (listener: () => void) => {
  featureListeners.add(listener);
  return () => featureListeners.delete(listener);
};

export function useEmbedFeatures(): ReadonlyArray<EmbedFeature> | null {
  return useSyncExternalStore(subscribeFeatures, () => features);
}

/** Parent messages a page reacts to (`threads`, `comment-sent`). */
export function subscribeParentMessages(
  listener: (message: EmbedParentMessage) => void,
): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

function setFeatures(next: ReadonlyArray<EmbedFeature>): void {
  features = next;
  removeSendToAgent?.();
  removeSendToAgent = next.includes("send-to-agent")
    ? setSendToAgentHandler(({ docId, docTitle, tabId, thread, url }) =>
        postToParent({
          type: "t3-docs:send-comment",
          requestId: crypto.randomUUID(),
          docId,
          tabId,
          docTitle,
          url,
          commentId: thread.root.id,
          quote: thread.root.quote,
          entries: [thread.root, ...thread.replies].map((comment) => ({
            id: comment.id,
            author: isAgentAuthor(comment.author) ? "agent" : "user",
            body: comment.body,
          })),
        }),
      )
    : null;
  for (const listener of featureListeners) listener();
}

/**
 * Lets T3 Code drive this app from its Docs panel. The browser already refuses
 * framing by origins outside FRAME_ANCESTORS; messages are still checked
 * against the same list, and replies go only to the origin that said hello.
 */
export function startEmbedBridge(): void {
  if (window.parent === window) return;
  const sources = (
    document.querySelector(`meta[name="${EMBED_ORIGINS_META}"]`)?.getAttribute("content") ?? ""
  )
    .split(" ")
    .filter(Boolean);

  const postLocation = () => {
    const path = window.location.pathname;
    const route = parseRoute(path);
    postToParent({
      type: "t3-docs:location",
      path,
      docId: route.name === "doc" ? route.docId : null,
      tabId: route.name === "doc" ? route.tabId : null,
    });
  };

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent || !isAllowedEmbedOrigin(event.origin, sources)) return;
    const message = parseParentMessage(event.data);
    if (!message) return;
    if (message.type === "t3-docs:hello") {
      parentOrigin = event.origin;
      setFeatures(message.features ?? []);
      postLocation();
      return;
    }
    if (!parentOrigin) return;
    if (message.type === "t3-docs:navigate") {
      navigate(message.path);
    } else if (message.type === "t3-docs:link-thread") {
      const { docId, environmentId, threadId, title } = message;
      // Acknowledged only once stored, so T3 Code retries a link that failed.
      void api.linkThread(docId, { environmentId, threadId, title }).then(
        () => postToParent({ type: "t3-docs:thread-linked", docId, environmentId, threadId }),
        () => undefined,
      );
    }
    for (const listener of messageListeners) listener(message);
  });
  subscribePathname(postLocation);
}
