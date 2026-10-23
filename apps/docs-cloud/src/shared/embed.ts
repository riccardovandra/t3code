/**
 * T3 Code embeds Docs Cloud in an iframe and talks to it over postMessage.
 *
 * Parent -> frame: `hello` (sent on every iframe load; the frame answers with
 * `location`; `features` lists what this T3 Code can do for the doc),
 * `navigate` (an app path such as `/d/:docId/:tabId`), `link-thread` (record a
 * thread started from a doc), `threads` (which linked threads it can open, with
 * their current titles) and `comment-sent` (how a sent comment went).
 * Frame -> parent: `location` after hello and on every route change,
 * `start-work`, `resolve-threads`, `open-thread`, `thread-linked` (the
 * link-thread record is stored) and `send-comment`.
 * Every message is additive: an older peer ignores types it does not know.
 */
export type EmbedFeature = "start-work" | "send-to-agent";

/** A T3 Code thread, by the environment that owns it. */
export interface EmbedThreadRef {
  readonly environmentId: string;
  readonly threadId: string;
}

export type EmbedParentMessage =
  | { readonly type: "t3-docs:hello"; readonly features?: ReadonlyArray<EmbedFeature> }
  | { readonly type: "t3-docs:navigate"; readonly path: string }
  | {
      readonly type: "t3-docs:link-thread";
      readonly docId: string;
      readonly environmentId: string;
      readonly threadId: string;
      readonly title: string;
    }
  | {
      readonly type: "t3-docs:threads";
      readonly threads: ReadonlyArray<EmbedThreadRef & { readonly title: string }>;
    }
  | {
      readonly type: "t3-docs:comment-sent";
      readonly requestId: string;
      /** Null when it reached the agent, else a message for the user. */
      readonly error: string | null;
    };

export interface EmbedLocationMessage {
  readonly type: "t3-docs:location";
  readonly path: string;
  readonly docId: string | null;
  readonly tabId: string | null;
}

/** One message of a comment thread, oldest first. */
export interface EmbedCommentEntry {
  readonly id: string;
  readonly author: "user" | "agent";
  readonly body: string;
}

export type EmbedFrameMessage =
  | EmbedLocationMessage
  | {
      readonly type: "t3-docs:start-work";
      readonly docId: string;
      readonly tabId: string | null;
      readonly title: string;
      readonly url: string;
    }
  | { readonly type: "t3-docs:resolve-threads"; readonly threads: ReadonlyArray<EmbedThreadRef> }
  | ({ readonly type: "t3-docs:open-thread" } & EmbedThreadRef)
  | ({ readonly type: "t3-docs:thread-linked"; readonly docId: string } & EmbedThreadRef)
  | {
      readonly type: "t3-docs:send-comment";
      readonly requestId: string;
      readonly docId: string;
      readonly tabId: string;
      readonly docTitle: string;
      readonly url: string;
      readonly commentId: string;
      readonly quote: string;
      readonly entries: ReadonlyArray<EmbedCommentEntry>;
    };

const FEATURES: ReadonlyArray<EmbedFeature> = ["start-work", "send-to-agent"];

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isThreadRef = (value: unknown): value is EmbedThreadRef =>
  isObject(value) && isText(value.environmentId) && isText(value.threadId);

/**
 * The parent's message when it is well formed, else null. The origin and
 * source are checked by the caller; this guards the shape, since the parent
 * is a different app that may be older or newer than this one.
 */
export function parseParentMessage(data: unknown): EmbedParentMessage | null {
  if (!isObject(data)) return null;
  switch (data.type) {
    case "t3-docs:hello":
      return {
        type: data.type,
        features: Array.isArray(data.features)
          ? FEATURES.filter((feature) => (data.features as Array<unknown>).includes(feature))
          : [],
      };
    case "t3-docs:navigate":
      return typeof data.path === "string" &&
        data.path.startsWith("/") &&
        !data.path.startsWith("//")
        ? { type: data.type, path: data.path }
        : null;
    case "t3-docs:link-thread":
      return isText(data.docId) && isThreadRef(data) && isText(data.title, 1_000)
        ? {
            type: data.type,
            docId: data.docId,
            environmentId: data.environmentId,
            threadId: data.threadId,
            title: data.title,
          }
        : null;
    case "t3-docs:threads":
      return Array.isArray(data.threads)
        ? {
            type: data.type,
            threads: data.threads
              .filter(
                (thread): thread is EmbedThreadRef & { title: string } =>
                  isThreadRef(thread) && isText(thread.title, 1_000),
              )
              .map(({ environmentId, threadId, title }) => ({ environmentId, threadId, title })),
          }
        : null;
    case "t3-docs:comment-sent":
      return isText(data.requestId) && (data.error === null || isText(data.error, 1_000))
        ? { type: data.type, requestId: data.requestId, error: data.error }
        : null;
    default:
      return null;
  }
}

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
