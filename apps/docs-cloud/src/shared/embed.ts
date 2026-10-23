/**
 * T3 Code embeds Docs Cloud in an iframe and talks to it over postMessage.
 *
 * Parent -> frame: `hello` (sent on every iframe load; the frame answers with
 * `location`; `features` lists what this T3 Code can do for the doc),
 * `navigate` (an app path such as `/d/:docId/:tabId`), `link-thread` (record a
 * thread started from a doc), `threads` (which linked threads it can open, with
 * their current titles), `comment-sent` (how a sent comment went), `context`
 * (the T3 Code project the panel belongs to, by key and name, after hello and
 * on change) and `theme` (T3 Code's appearance and resolved palette, after
 * hello and on change; the mobile app sends the same message to the top-level
 * page).
 * Frame -> parent: `location` after hello and on every route change,
 * `copy-to-claude-doc` (recreate the doc in Claude Docs), `start-work`,
 * `resolve-threads`, `open-thread`, `thread-linked` (the link-thread record is
 * stored) and `send-comment`. Frame actions are only offered once a parent has
 * said hello. Every message is additive: an older peer ignores unknown types.
 */
import { THEME_COLOR_ROLES, type ThemeColorRole } from "@t3tools/shared/themePalettes";

export type EmbedFeature = "start-work" | "send-to-agent";

/** T3 Code's resolved palette, by its theme colour roles. */
export type EmbedThemeColors = Readonly<Partial<Record<ThemeColorRole, string>>>;

export interface EmbedThemeMessage {
  readonly type: "t3-docs:theme";
  readonly appearance: "light" | "dark";
  /** Absent for a peer that sends only the appearance; this app's T3 defaults then apply. */
  readonly colors: EmbedThemeColors | null;
}

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
    }
  | {
      readonly type: "t3-docs:context";
      /** The T3 Code project's title, for display and for peers that predate keys. */
      readonly projectName: string | null;
      /** Its Docs Cloud project key (see `normalizeProjectKey`); absent from older peers. */
      readonly projectKey: string | null;
    }
  | EmbedThemeMessage;

/** Titles compare ignoring case and spacing. */
export const projectNameKey = (name: string): string =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

const TITLE_KEY_PREFIX = "title:";
export const MAX_PROJECT_KEY_LENGTH = 300;

/**
 * Docs Cloud projects are T3 Code projects, identified by a key the T3 server
 * derives (DocsCloudImport's `docsCloudProjectKey` mirrors this): the git
 * remote's canonical key such as `github.com/owner/repo`, so every checkout of
 * a repository on every machine shares one project, else `title:` and the
 * normalised title.
 */
export const titleProjectKey = (name: string): string => TITLE_KEY_PREFIX + projectNameKey(name);

/** A key in its stored form (title keys normalised), or null when it is not a usable key. */
export function normalizeProjectKey(key: string): string | null {
  const trimmed = key.trim();
  const normalized = trimmed.toLowerCase().startsWith(TITLE_KEY_PREFIX)
    ? titleProjectKey(trimmed.slice(TITLE_KEY_PREFIX.length))
    : trimmed;
  return normalized.length > 0 &&
    normalized !== TITLE_KEY_PREFIX &&
    normalized.length <= MAX_PROJECT_KEY_LENGTH
    ? normalized
    : null;
}

/** A display name for a key nobody named: the repository or the title. */
export const projectNameFromKey = (key: string): string =>
  key.startsWith(TITLE_KEY_PREFIX)
    ? key.slice(TITLE_KEY_PREFIX.length)
    : (key.split("/").findLast((part) => part.length > 0) ?? key);

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

/** One message of a comment thread, oldest first. */
export interface EmbedCommentEntry {
  readonly id: string;
  readonly author: "user" | "agent";
  readonly body: string;
}

export type EmbedFrameMessage =
  | EmbedLocationMessage
  | EmbedCopyToClaudeDocMessage
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

const THEME_ROLES: ReadonlySet<string> = new Set(THEME_COLOR_ROLES);
// Colours become CSS custom properties, which accept any token stream, so only
// literal colours pass: no url(), var() or anything that could close the rule.
const THEME_COLOR =
  /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([0-9a-z.,%/\s+-]{1,80}\))$/i;

/** The well formed colours of a theme message; unknown roles and values are dropped. */
function parseThemeColors(value: unknown): EmbedThemeColors | null {
  if (!isObject(value)) return null;
  const colors: Partial<Record<ThemeColorRole, string>> = {};
  for (const [role, color] of Object.entries(value)) {
    if (THEME_ROLES.has(role) && typeof color === "string" && THEME_COLOR.test(color.trim())) {
      colors[role as ThemeColorRole] = color.trim();
    }
  }
  return colors;
}

export function parseThemeMessage(data: unknown): EmbedThemeMessage | null {
  if (!isObject(data) || data.type !== "t3-docs:theme") return null;
  if (data.appearance !== "light" && data.appearance !== "dark") return null;
  return { type: data.type, appearance: data.appearance, colors: parseThemeColors(data.colors) };
}

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
    case "t3-docs:link-thread": {
      const { docId, title } = data;
      return isText(docId) && isText(title, 1_000) && isThreadRef(data)
        ? {
            type: data.type,
            docId,
            environmentId: data.environmentId,
            threadId: data.threadId,
            title,
          }
        : null;
    }
    case "t3-docs:threads":
      return Array.isArray(data.threads)
        ? {
            type: data.type,
            threads: data.threads
              .filter(
                (thread): thread is EmbedThreadRef & { title: string } =>
                  isObject(thread) && isText(thread.title, 1_000) && isThreadRef(thread),
              )
              .map(({ environmentId, threadId, title }) => ({ environmentId, threadId, title })),
          }
        : null;
    case "t3-docs:comment-sent":
      return isText(data.requestId) && (data.error === null || isText(data.error, 1_000))
        ? { type: data.type, requestId: data.requestId, error: data.error }
        : null;
    case "t3-docs:context": {
      if (data.projectName !== null && !isText(data.projectName, 1_000)) return null;
      const projectKey =
        typeof data.projectKey === "string" ? normalizeProjectKey(data.projectKey) : null;
      return {
        type: data.type,
        projectName: data.projectName === null ? null : data.projectName.trim() || null,
        projectKey,
      };
    }
    case "t3-docs:theme":
      return parseThemeMessage(data);
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
