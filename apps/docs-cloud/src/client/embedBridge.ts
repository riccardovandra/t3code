import { useSyncExternalStore } from "react";

import {
  EMBED_ORIGINS_META,
  isAllowedEmbedOrigin,
  parseParentMessage,
  type EmbedFeature,
  type EmbedFrameMessage,
  type EmbedParentMessage,
} from "../shared/embed.ts";
import { api } from "./api.ts";
import { setAddToChatHandler } from "./comments/addToChat.ts";
import { setEmbedProject } from "./embedContext.ts";
import { navigate, parseRoute, subscribePathname } from "./router.ts";
import { applyTheme } from "./theme.ts";

let parentOrigin: string | null = null;
/** What the T3 Code that said hello offers beyond navigation. */
let features: ReadonlyArray<EmbedFeature> = [];
const parentListeners = new Set<() => void>();
const messageListeners = new Set<(message: EmbedParentMessage) => void>();
let removeAddToChat: (() => void) | null = null;

/** True once T3 Code has said hello, so features that need it can show. */
export function hasEmbedParent(): boolean {
  return parentOrigin !== null;
}

export function subscribeEmbedParent(listener: () => void): () => void {
  parentListeners.add(listener);
  return () => parentListeners.delete(listener);
}

/** Sends to the T3 Code window that said hello; a no-op outside T3 Code. */
export function postToEmbedParent(message: EmbedFrameMessage): void {
  if (parentOrigin) window.parent.postMessage(message, parentOrigin);
}

const embedFeatures = () => (parentOrigin === null ? null : features);

/** The embedding T3 Code's features; null outside T3 Code or before its hello. */
export function useEmbedFeatures(): ReadonlyArray<EmbedFeature> | null {
  return useSyncExternalStore(subscribeEmbedParent, embedFeatures);
}

/** Parent messages a page reacts to (`threads`, `sent-to`). */
export function subscribeParentMessages(
  listener: (message: EmbedParentMessage) => void,
): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

function installAddToChat(enabled: boolean): void {
  removeAddToChat?.();
  removeAddToChat = enabled
    ? setAddToChatHandler((comment) =>
        postToEmbedParent({ type: "t3-docs:add-comment-to-chat", ...comment }),
      )
    : null;
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
    postToEmbedParent({
      type: "t3-docs:location",
      path,
      docId: route.name === "doc" ? route.docId : null,
      tabId: route.name === "doc" ? route.tabId : null,
      localPath: route.name === "local" ? route.path : null,
    });
  };

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent || !isAllowedEmbedOrigin(event.origin, sources)) return;
    const message = parseParentMessage(event.data);
    if (!message) return;
    if (message.type === "t3-docs:hello") {
      const next = message.features ?? [];
      const changed = parentOrigin !== event.origin || next.join(" ") !== features.join(" ");
      parentOrigin = event.origin;
      features = next;
      installAddToChat(next.includes("add-to-chat"));
      if (changed) for (const listener of parentListeners) listener();
      postLocation();
      return;
    }
    if (!parentOrigin) return;
    if (message.type === "t3-docs:navigate") {
      navigate(message.path);
    } else if (message.type === "t3-docs:context") {
      setEmbedProject(
        message.projectName === null
          ? null
          : { name: message.projectName, key: message.projectKey },
      );
    } else if (message.type === "t3-docs:theme") {
      applyTheme(message);
    } else if (message.type === "t3-docs:link-thread") {
      const { docId, environmentId, threadId, title } = message;
      // Acknowledged only once stored, so T3 Code retries a link that failed.
      void api.linkThread(docId, { environmentId, threadId, title }).then(
        () => postToEmbedParent({ type: "t3-docs:thread-linked", docId, environmentId, threadId }),
        () => undefined,
      );
    }
    for (const listener of messageListeners) listener(message);
  });
  subscribePathname(postLocation);
}
