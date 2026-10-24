/**
 * Docs Cloud framed in T3 Code opens the project's markdown files through the
 * T3 Code window, which reads and writes them over its environment connection.
 * The file text only crosses postMessage between the two pages; it never
 * reaches the Docs Cloud worker.
 *
 * Frame -> host: `local-request` (a request id and one request).
 * Host -> frame: `local-response` (the same id, a result or an error),
 * `local-files-changed` (files may have changed on disk, e.g. after an agent
 * turn) and `local-comments-changed` (an agent may have replied to or resolved
 * a comment). The host offers files with the `local-files` feature in its
 * hello, and comments on them with `local-comments`.
 *
 * Comments on project files live on the T3 server, not in Docs Cloud; the
 * frame shows them with the same margin as a cloud doc's.
 *
 * Both sides parse strictly, since either page may be older or newer than the
 * other. A request kind is added by extending `LocalDocRequest`,
 * `LocalDocResults` and the two parser tables below.
 */
import { DOCS_ROOT, isMarkdownPath } from "./docPaths.ts";

export const LOCAL_FILES_FEATURE = "local-files";
export const LOCAL_COMMENTS_FEATURE = "local-comments";

export const LOCAL_REQUEST_TYPE = "t3-docs:local-request";
export const LOCAL_RESPONSE_TYPE = "t3-docs:local-response";
export const LOCAL_FILES_CHANGED_TYPE = "t3-docs:local-files-changed";
export const LOCAL_COMMENTS_CHANGED_TYPE = "t3-docs:local-comments-changed";

const MAX_PATH_LENGTH = 512;
const MAX_REQUEST_ID_LENGTH = 100;
const MAX_ERROR_LENGTH = 1_000;
const MAX_FILES = 2_000;
const MAX_COMMENTS = 5_000;
const MAX_COMMENT_ID_LENGTH = 64;
// The T3 server's limits for a comment.
const MAX_COMMENT_BODY_LENGTH = 10_000;
export const MAX_LOCAL_QUOTE_LENGTH = 2_000;
export const MAX_LOCAL_CONTEXT_LENGTH = 200;
/** Above the server's read cap, so any file it serves whole can be saved back. */
const MAX_LOCAL_MARKDOWN_LENGTH = 5_000_000;

/** A markdown file in the project, by its workspace-relative path. */
export interface LocalDocSummary {
  readonly path: string;
  readonly title: string;
}

/** A file as read from disk. `version` changes whenever its text does. */
export interface LocalDocFile {
  readonly path: string;
  readonly markdown: string;
  readonly version: string;
  /** Why the host will not write it (permissions, size), else null. */
  readonly readOnlyReason: string | null;
}

/**
 * One comment or reply on a project file, flattened: a reply names its root in
 * `parentId` and carries no quote. Times are epoch milliseconds.
 */
export interface LocalDocComment {
  readonly id: string;
  readonly parentId: string | null;
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly body: string;
  readonly author: "user" | "agent";
  /** Set on a resolved root. */
  readonly resolvedAt: number | null;
  readonly createdAt: number;
}

/** A file's comments as the host has them now; every comment request answers with this. */
export interface LocalDocComments {
  readonly comments: ReadonlyArray<LocalDocComment>;
  /** False when this connection may only read comments. */
  readonly canComment: boolean;
  /** True when a comment can be sent to the conversation's doc agent. */
  readonly canSendToAgent: boolean;
}

type CommentTarget = { readonly path: string; readonly commentId: string };

export type LocalDocRequest =
  | { readonly kind: "files.list" }
  | { readonly kind: "file.read"; readonly path: string }
  | {
      readonly kind: "file.write";
      readonly path: string;
      readonly markdown: string;
      /** The version the edit started from; a different file on disk is a conflict. */
      readonly baseVersion: string;
    }
  | { readonly kind: "comments.list"; readonly path: string }
  | {
      readonly kind: "comment.create";
      readonly path: string;
      readonly quote: string;
      readonly prefix: string;
      readonly suffix: string;
      readonly body: string;
      /** Deliver it to the conversation's doc agent, which acts on it and replies. */
      readonly sendToAgent: boolean;
    }
  | ({
      readonly kind: "comment.reply";
      readonly body: string;
      readonly sendToAgent: boolean;
    } & CommentTarget)
  | ({ readonly kind: "comment.resolve"; readonly resolved: boolean } & CommentTarget)
  | ({ readonly kind: "comment.delete" } & CommentTarget)
  /** Puts the thread in the conversation's composer, as "Add to chat" does for a cloud comment. */
  | ({ readonly kind: "comment.chat" } & CommentTarget);

export type LocalDocRequestKind = LocalDocRequest["kind"];

export interface LocalDocResults {
  readonly "files.list": { readonly files: ReadonlyArray<LocalDocSummary> };
  readonly "file.read": LocalDocFile;
  readonly "file.write":
    | { readonly status: "saved"; readonly version: string }
    | { readonly status: "conflict"; readonly file: LocalDocFile };
  readonly "comments.list": LocalDocComments;
  /** `commentId` is the new thread's root. */
  readonly "comment.create": LocalDocComments & { readonly commentId: string };
  readonly "comment.reply": LocalDocComments;
  readonly "comment.resolve": LocalDocComments;
  readonly "comment.delete": LocalDocComments;
  readonly "comment.chat": { readonly added: true };
}

export interface LocalRequestMessage {
  readonly type: typeof LOCAL_REQUEST_TYPE;
  readonly requestId: string;
  readonly request: LocalDocRequest;
}

export type LocalResponseMessage =
  | {
      readonly type: typeof LOCAL_RESPONSE_TYPE;
      readonly requestId: string;
      readonly ok: true;
      /** Checked against the request's kind by the frame, which knows what it asked. */
      readonly result: unknown;
    }
  | {
      readonly type: typeof LOCAL_RESPONSE_TYPE;
      readonly requestId: string;
      readonly ok: false;
      readonly error: string;
    };

export interface LocalFilesChangedMessage {
  readonly type: typeof LOCAL_FILES_CHANGED_TYPE;
}

/** The open file's comments may have changed; the frame lists them again. */
export interface LocalCommentsChangedMessage {
  readonly type: typeof LOCAL_COMMENTS_CHANGED_TYPE;
}

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isMarkdown = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_LOCAL_MARKDOWN_LENGTH;
const isContext = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_LOCAL_CONTEXT_LENGTH;
const isCommentId = (value: unknown): value is string => isText(value, MAX_COMMENT_ID_LENGTH);
const isBody = (value: unknown): value is string =>
  isText(value, MAX_COMMENT_BODY_LENGTH) && value.trim().length > 0;
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * Only markdown under the project's docs folder crosses the bridge, so a
 * misbehaving frame cannot read or overwrite anything else in the checkout.
 */
export function isLocalDocPath(path: unknown): path is string {
  if (!isText(path, MAX_PATH_LENGTH) || !isMarkdownPath(path)) return false;
  const segments = path.split("/");
  return (
    segments[0] === DOCS_ROOT &&
    segments.length > 1 &&
    segments.every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        // Control characters and backslashes have no place in a docs path.
        // oxlint-disable-next-line no-control-regex
        !/[\\\u0000-\u001f\u007f]/.test(segment),
    )
  );
}

/** Changes with the text. Not cryptographic: it only has to notice an edit on disk. */
export function localDocVersion(markdown: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < markdown.length; index += 1) {
    const code = markdown.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  return `${markdown.length.toString(36)}-${hash}`;
}

const REQUEST_PARSERS: {
  readonly [K in LocalDocRequestKind]: (
    fields: Fields,
  ) => Extract<LocalDocRequest, { kind: K }> | null;
} = {
  "files.list": () => ({ kind: "files.list" }),
  "file.read": (fields) =>
    isLocalDocPath(fields.path) ? { kind: "file.read", path: fields.path } : null,
  "file.write": (fields) =>
    isLocalDocPath(fields.path) && isMarkdown(fields.markdown) && isText(fields.baseVersion, 100)
      ? {
          kind: "file.write",
          path: fields.path,
          markdown: fields.markdown,
          baseVersion: fields.baseVersion,
        }
      : null,
  "comments.list": (fields) =>
    isLocalDocPath(fields.path) ? { kind: "comments.list", path: fields.path } : null,
  "comment.create": (fields) =>
    isLocalDocPath(fields.path) &&
    isText(fields.quote, MAX_LOCAL_QUOTE_LENGTH) &&
    fields.quote.trim().length > 0 &&
    isContext(fields.prefix) &&
    isContext(fields.suffix) &&
    isBody(fields.body) &&
    typeof fields.sendToAgent === "boolean"
      ? {
          kind: "comment.create",
          path: fields.path,
          quote: fields.quote,
          prefix: fields.prefix,
          suffix: fields.suffix,
          body: fields.body,
          sendToAgent: fields.sendToAgent,
        }
      : null,
  "comment.reply": (fields) => {
    const target = parseCommentTarget(fields);
    return target && isBody(fields.body) && typeof fields.sendToAgent === "boolean"
      ? { kind: "comment.reply", ...target, body: fields.body, sendToAgent: fields.sendToAgent }
      : null;
  },
  "comment.resolve": (fields) => {
    const target = parseCommentTarget(fields);
    return target && typeof fields.resolved === "boolean"
      ? { kind: "comment.resolve", ...target, resolved: fields.resolved }
      : null;
  },
  "comment.delete": (fields) => {
    const target = parseCommentTarget(fields);
    return target && { kind: "comment.delete", ...target };
  },
  "comment.chat": (fields) => {
    const target = parseCommentTarget(fields);
    return target && { kind: "comment.chat", ...target };
  },
};

function parseCommentTarget(fields: Fields): CommentTarget | null {
  return isLocalDocPath(fields.path) && isCommentId(fields.commentId)
    ? { path: fields.path, commentId: fields.commentId }
    : null;
}

const isRequestKind = (kind: unknown): kind is LocalDocRequestKind =>
  typeof kind === "string" && Object.hasOwn(REQUEST_PARSERS, kind);

/** The frame's request when well formed, else null; the host checks origin and source. */
export function parseLocalRequestMessage(data: unknown): LocalRequestMessage | null {
  if (!isObject(data) || data.type !== LOCAL_REQUEST_TYPE) return null;
  if (!isText(data.requestId, MAX_REQUEST_ID_LENGTH) || !isObject(data.request)) return null;
  const { kind } = data.request;
  if (!isRequestKind(kind)) return null;
  const request = REQUEST_PARSERS[kind](data.request);
  return request ? { type: LOCAL_REQUEST_TYPE, requestId: data.requestId, request } : null;
}

/** The envelope of the host's answer; the result is checked by `parseLocalResult`. */
export function parseLocalResponseMessage(data: unknown): LocalResponseMessage | null {
  if (!isObject(data) || data.type !== LOCAL_RESPONSE_TYPE) return null;
  if (!isText(data.requestId, MAX_REQUEST_ID_LENGTH)) return null;
  if (data.ok === true) {
    return { type: LOCAL_RESPONSE_TYPE, requestId: data.requestId, ok: true, result: data.result };
  }
  return data.ok === false && isText(data.error, MAX_ERROR_LENGTH)
    ? { type: LOCAL_RESPONSE_TYPE, requestId: data.requestId, ok: false, error: data.error }
    : null;
}

function parseFile(value: unknown): LocalDocFile | null {
  if (!isObject(value) || !isLocalDocPath(value.path) || !isMarkdown(value.markdown)) return null;
  if (!isText(value.version, 100)) return null;
  if (value.readOnlyReason !== null && !isText(value.readOnlyReason, MAX_ERROR_LENGTH)) return null;
  return {
    path: value.path,
    markdown: value.markdown,
    version: value.version,
    readOnlyReason: value.readOnlyReason,
  };
}

function parseComment(value: unknown): LocalDocComment | null {
  if (!isObject(value) || !isCommentId(value.id)) return null;
  if (value.parentId !== null && !isCommentId(value.parentId)) return null;
  if (!isMarkdown(value.quote) || !isMarkdown(value.prefix) || !isMarkdown(value.suffix)) {
    return null;
  }
  if (typeof value.body !== "string" || value.body.length > MAX_COMMENT_BODY_LENGTH) return null;
  if (value.author !== "user" && value.author !== "agent") return null;
  if (value.resolvedAt !== null && !isTime(value.resolvedAt)) return null;
  if (!isTime(value.createdAt)) return null;
  return {
    id: value.id,
    parentId: value.parentId,
    quote: value.quote,
    prefix: value.prefix,
    suffix: value.suffix,
    body: value.body,
    author: value.author,
    resolvedAt: value.resolvedAt,
    createdAt: value.createdAt,
  };
}

function parseComments(value: unknown): LocalDocComments | null {
  if (!isObject(value) || !Array.isArray(value.comments)) return null;
  if (typeof value.canComment !== "boolean" || typeof value.canSendToAgent !== "boolean") {
    return null;
  }
  // One malformed comment is dropped rather than hiding the rest.
  const comments = value.comments
    .map(parseComment)
    .filter((comment): comment is LocalDocComment => comment !== null)
    .slice(0, MAX_COMMENTS);
  return { comments, canComment: value.canComment, canSendToAgent: value.canSendToAgent };
}

const RESULT_PARSERS: {
  readonly [K in LocalDocRequestKind]: (value: unknown) => LocalDocResults[K] | null;
} = {
  "files.list": (value) => {
    if (!isObject(value) || !Array.isArray(value.files)) return null;
    const files = value.files
      .filter(
        (file): file is LocalDocSummary =>
          isObject(file) && isLocalDocPath(file.path) && isText(file.title, MAX_PATH_LENGTH),
      )
      .slice(0, MAX_FILES)
      .map(({ path, title }) => ({ path, title }));
    return { files };
  },
  "file.read": parseFile,
  "file.write": (value) => {
    if (!isObject(value)) return null;
    if (value.status === "saved") {
      return isText(value.version, 100) ? { status: "saved", version: value.version } : null;
    }
    const file = value.status === "conflict" ? parseFile(value.file) : null;
    return file ? { status: "conflict", file } : null;
  },
  "comments.list": parseComments,
  "comment.create": (value) => {
    const comments = parseComments(value);
    return comments && isObject(value) && isCommentId(value.commentId)
      ? { ...comments, commentId: value.commentId }
      : null;
  },
  "comment.reply": parseComments,
  "comment.resolve": parseComments,
  "comment.delete": parseComments,
  "comment.chat": (value) => (isObject(value) && value.added === true ? { added: true } : null),
};

/** A response's result when it is what a request of this kind answers with, else null. */
export function parseLocalResult<K extends LocalDocRequestKind>(
  kind: K,
  value: unknown,
): LocalDocResults[K] | null {
  return RESULT_PARSERS[kind](value);
}

/** The local route's app path for a file, e.g. `/local/docs/plans/q3.md`. */
export function localDocAppPath(path: string): string {
  return `/local/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The file a local route opens, or null when the path is not one. */
export function localDocPathFromAppPath(appPath: string): string | null {
  const [first, ...rest] = appPath.split("/").filter(Boolean);
  if (first !== "local" || rest.length === 0) return null;
  let path: string;
  try {
    path = rest.map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  return isLocalDocPath(path) ? path : null;
}
