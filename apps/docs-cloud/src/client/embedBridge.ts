import {
  EMBED_ORIGINS_META,
  isAllowedEmbedOrigin,
  type EmbedLocationMessage,
  type EmbedParentMessage,
} from "../shared/embed.ts";
import { setEmbedProjectName } from "./embedContext.ts";
import { navigate, parseRoute, subscribePathname } from "./router.ts";

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
  let parentOrigin: string | null = null;

  const postLocation = () => {
    if (!parentOrigin) return;
    const path = window.location.pathname;
    const route = parseRoute(path);
    const message: EmbedLocationMessage = {
      type: "t3-docs:location",
      path,
      docId: route.name === "doc" ? route.docId : null,
      tabId: route.name === "doc" ? route.tabId : null,
    };
    window.parent.postMessage(message, parentOrigin);
  };

  window.addEventListener("message", (event: MessageEvent<EmbedParentMessage>) => {
    if (event.source !== window.parent || !isAllowedEmbedOrigin(event.origin, sources)) return;
    const message = event.data;
    if (message?.type === "t3-docs:hello") {
      parentOrigin = event.origin;
      postLocation();
    } else if (
      message?.type === "t3-docs:navigate" &&
      typeof message.path === "string" &&
      message.path.startsWith("/") &&
      !message.path.startsWith("//")
    ) {
      navigate(message.path);
    } else if (message?.type === "t3-docs:context") {
      const name = typeof message.projectName === "string" ? message.projectName.trim() : "";
      setEmbedProjectName(name === "" ? null : name);
    }
  });
  subscribePathname(postLocation);
}
