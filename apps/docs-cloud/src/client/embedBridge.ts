import {
  EMBED_ORIGINS_META,
  isAllowedEmbedOrigin,
  type EmbedFrameMessage,
  type EmbedParentMessage,
} from "../shared/embed.ts";
import { navigate, parseRoute, subscribePathname } from "./router.ts";

let parentOrigin: string | null = null;
const parentListeners = new Set<() => void>();

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
    });
  };

  window.addEventListener("message", (event: MessageEvent<EmbedParentMessage>) => {
    if (event.source !== window.parent || !isAllowedEmbedOrigin(event.origin, sources)) return;
    const message = event.data;
    if (message?.type === "t3-docs:hello") {
      const changed = parentOrigin !== event.origin;
      parentOrigin = event.origin;
      if (changed) for (const listener of parentListeners) listener();
      postLocation();
    } else if (
      message?.type === "t3-docs:navigate" &&
      typeof message.path === "string" &&
      message.path.startsWith("/") &&
      !message.path.startsWith("//")
    ) {
      navigate(message.path);
    }
  });
  subscribePathname(postLocation);
}
