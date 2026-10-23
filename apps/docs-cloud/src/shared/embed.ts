/**
 * T3 Code embeds Docs Cloud in an iframe and talks to it over postMessage.
 *
 * Parent -> frame: `hello` (sent on every iframe load; the frame answers with
 * `location`) and `navigate` (an app path such as `/d/:docId/:tabId`).
 * Frame -> parent: `location` after hello and on every route change, and
 * `copy-to-claude-doc` when the user asks T3 Code to recreate a doc in Claude
 * Docs (only offered once a parent has said hello).
 */
export type EmbedParentMessage =
  | { readonly type: "t3-docs:hello" }
  | { readonly type: "t3-docs:navigate"; readonly path: string };

export interface EmbedLocationMessage {
  readonly type: "t3-docs:location";
  readonly path: string;
  readonly docId: string | null;
  readonly tabId: string | null;
}

export interface EmbedCopyToClaudeDocMessage {
  readonly type: "t3-docs:copy-to-claude-doc";
  readonly docId: string;
  readonly title: string;
  /** The doc's permanent URL. */
  readonly url: string;
}

export type EmbedFrameMessage = EmbedLocationMessage | EmbedCopyToClaudeDocMessage;

export const EMBED_ORIGINS_META = "t3-embed-origins";

const SOURCE = /^([a-z][a-z0-9+.-]*):\/\/(\*\.)?([a-z0-9.-]+)(?::(\d+|\*))?$/i;
const ORIGIN = /^([a-z][a-z0-9+.-]*):\/\/([a-z0-9.-]+)(?::(\d+))?$/i;
const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443" };

/** Splits the FRAME_ANCESTORS var into CSP host-sources, dropping anything that is not one. */
export function parseEmbedOrigins(value: string | undefined): ReadonlyArray<string> {
  return (value ?? "").split(/[\s,]+/).filter((source) => SOURCE.test(source));
}

export function frameAncestorsPolicy(sources: ReadonlyArray<string>): string {
  return `frame-ancestors ${sources.length > 0 ? sources.join(" ") : "'none'"}`;
}

/**
 * Matches an origin against CSP host-sources the way the browser does for
 * frame-ancestors. Parsed by hand because `URL#origin` is opaque for custom
 * schemes such as the desktop app's `t3code://app`.
 */
export function isAllowedEmbedOrigin(origin: string, sources: ReadonlyArray<string>): boolean {
  const parsed = ORIGIN.exec(origin);
  if (!parsed) return false;
  const scheme = parsed[1]!.toLowerCase();
  const hostname = parsed[2]!.toLowerCase();
  const port = parsed[3] ?? DEFAULT_PORTS[scheme];
  return sources.some((source) => {
    const match = SOURCE.exec(source);
    if (!match || match[1]!.toLowerCase() !== scheme) return false;
    const host = match[3]!.toLowerCase();
    if (match[2] ? !hostname.endsWith(`.${host}`) : hostname !== host) return false;
    return match[4] === "*" || (match[4] ?? DEFAULT_PORTS[scheme]) === port;
  });
}
