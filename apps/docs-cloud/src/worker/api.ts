import {
  DOC_STATUSES,
  type DocStatus,
  type DocSummary,
  type DocThreadLink,
  type Tab,
  type TabPlacement,
} from "../shared/protocol.ts";
import { locateAnchor, markdownToText } from "../shared/anchors.ts";
import type { WidgetProblem } from "../shared/widget/check.ts";
import * as Auth from "./auth.ts";
import * as Comments from "./comments.ts";
import * as DocThreads from "./docThreads.ts";
import * as Docs from "./docs.ts";
import * as Export from "./export.ts";
import { widgetProblems } from "./widgets.ts";

/** The ordered write path for a doc; production routes it to the doc's DocRoom. */
export interface DocRooms {
  createTab(
    docId: string,
    input: {
      readonly parentTabId: string | null;
      readonly title: string;
      readonly markdown: string;
      readonly origin: string | null;
    },
  ): Promise<Tab>;
  writeTab(
    docId: string,
    input: {
      readonly tabId: string;
      readonly baseVersion: number;
      readonly markdown?: string;
      readonly title?: string;
      readonly origin: string | null;
    },
  ): Promise<Docs.TabWriteResult>;
  moveTab(
    docId: string,
    input: {
      readonly tabId: string;
      readonly parentTabId: string | null;
      readonly position: number;
      readonly origin: string | null;
    },
  ): Promise<ReadonlyArray<TabPlacement>>;
  /** Returns the ids of the tab and every descendant it took with it. */
  deleteTab(
    docId: string,
    input: { readonly tabId: string; readonly origin: string | null },
  ): Promise<ReadonlyArray<string>>;
  setDocStatus(
    docId: string,
    input: { readonly status: DocStatus; readonly origin: string | null },
  ): Promise<DocSummary>;
  commentOp(
    docId: string,
    input: { readonly op: Comments.CommentOp; readonly origin: string | null },
  ): Promise<Comments.CommentOpResult>;
  threadOp(
    docId: string,
    input: { readonly op: DocThreads.DocThreadOp; readonly origin: string | null },
  ): Promise<ReadonlyArray<DocThreadLink>>;
  openSocket(docId: string, request: Request): Promise<Response>;
}

export interface ApiDeps {
  readonly db: D1Database;
  /**
   * The app's public origin, for URLs handed out and the same-origin check.
   * `wrangler dev` rewrites request.url to the custom domain, so the request
   * cannot tell us where the app is really served from.
   */
  readonly publicOrigin: string;
  readonly owners: ReadonlySet<string>;
  readonly rooms: DocRooms;
  readonly sendLoginCode: (email: string, code: string) => Promise<void>;
  readonly waitUntil: (promise: Promise<unknown>) => void;
  readonly now: () => number;
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const error = (status: number, code: string) => json({ error: code }, status);
const widgetInvalid = (problems: ReadonlyArray<WidgetProblem>) =>
  json({ error: "widget_invalid", problems }, 422);

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (value: unknown, max = 200): string | null =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null;

const MAX_MARKDOWN_LENGTH = 1_000_000;

/**
 * Cookies are SameSite=None so the app works inside T3 Code's iframe, which
 * means the browser attaches them to cross-site requests too. Cookie-authed
 * mutations must come from this origin, and POSTs must be JSON, which a
 * cross-site form cannot send without a CORS preflight we never grant. Bearer
 * tokens are not ambient credentials and skip the check.
 */
const isOwnOrigin = (origin: string, request: Request, deps: ApiDeps) =>
  origin === deps.publicOrigin || origin === new URL(request.url).origin;

function isSameOriginWrite(request: Request, deps: ApiDeps): boolean {
  const origin = request.headers.get("Origin");
  if (origin !== null && !isOwnOrigin(origin, request, deps)) return false;
  if (request.method !== "POST") return true;
  return (request.headers.get("Content-Type") ?? "").startsWith("application/json");
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

export async function handleApi(request: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  const now = deps.now();

  if (path.startsWith("/api/auth/")) return handleAuth(request, path, deps);

  const principal = await Auth.authenticate(deps.db, request, now);
  if (!principal) return error(401, "unauthorized");

  const segments = path.split("/").slice(2); // drop "", "api"
  const [resource, id, sub, subId] = segments;

  // Socket handshakes carry the SameSite=None cookie cross-site too, so a
  // cookie-authed socket must come from this origin.
  if (resource === "docs" && id && sub === "ws" && method === "GET") {
    const origin = request.headers.get("Origin");
    if (principal.kind === "session" && origin !== null && !isOwnOrigin(origin, request, deps)) {
      return error(403, "forbidden_origin");
    }
    if (request.headers.get("Upgrade") !== "websocket") return error(426, "expected_websocket");
    try {
      await Docs.getDoc(deps.db, id);
    } catch (cause) {
      if (cause instanceof Docs.NotFoundError) return error(404, "not_found");
      throw cause;
    }
    return deps.rooms.openSocket(id, request);
  }

  if (
    principal.kind === "session" &&
    !SAFE_METHODS.has(method) &&
    !isSameOriginWrite(request, deps)
  ) {
    return error(403, "forbidden_origin");
  }

  try {
    if (path === "/api/me" && method === "GET") {
      return json(principal.kind === "session" ? { email: principal.email } : { token: true });
    }

    if (resource === "tokens") {
      // A leaked agent token must not be able to mint or revoke tokens.
      if (principal.kind !== "session") return error(403, "session_required");
      if (!id && method === "GET") return json({ tokens: await Auth.listApiTokens(deps.db) });
      if (!id && method === "POST") {
        const body = await readJson(request);
        const name = str(body.name, 100);
        if (!name) return error(400, "invalid_name");
        return json(await Auth.createApiToken(deps.db, name, now), 201);
      }
      if (id && method === "DELETE") {
        return (await Auth.revokeApiToken(deps.db, id, now))
          ? json({ ok: true })
          : error(404, "not_found");
      }
    }

    if (path === "/api/library" && method === "GET") {
      return json({ projects: await Docs.listLibrary(deps.db) });
    }

    if (path === "/api/projects" && method === "POST") {
      const name = str((await readJson(request)).name);
      if (!name) return error(400, "invalid_name");
      return json({ project: await Docs.createProject(deps.db, name, now) }, 201);
    }

    if (path === "/api/docs" && method === "POST") {
      const body = await readJson(request);
      const projectId = str(body.projectId);
      const title = str(body.title);
      if (!projectId || !title) return error(400, "invalid_doc");
      return json(await Docs.createDoc(deps.db, { projectId, title, now }), 201);
    }

    if (resource === "docs" && id && !sub && method === "GET") {
      return json(await Docs.getDoc(deps.db, id));
    }

    if (resource === "docs" && id && !sub && method === "PATCH") {
      const body = await readJson(request);
      const status = body.status;
      if (!DOC_STATUSES.includes(status as DocStatus)) return error(400, "invalid_status");
      const doc = await deps.rooms.setDocStatus(id, {
        status: status as DocStatus,
        origin: str(body.clientId),
      });
      return json({ doc });
    }

    if (resource === "docs" && id && sub === "threads") {
      const response = await handleDocThreads(request, { id, subId, method, url, principal }, deps);
      if (response) return response;
    }

    if (resource === "docs" && id && sub === "export.md" && method === "GET") {
      const doc = await Docs.getDoc(deps.db, id);
      return Export.markdownResponse(Export.docMarkdown(doc), doc.doc.title);
    }

    if (resource === "docs" && id && sub === "tabs" && method === "POST") {
      const body = await readJson(request);
      const title = str(body.title) ?? "Untitled";
      const parentTabId = body.parentTabId === undefined ? null : body.parentTabId;
      if (parentTabId !== null && typeof parentTabId !== "string") {
        return error(400, "invalid_parent");
      }
      const markdown = typeof body.markdown === "string" ? body.markdown : "";
      if (markdown.length > MAX_MARKDOWN_LENGTH) return error(413, "too_large");
      const problems = widgetProblems(markdown);
      if (problems) return widgetInvalid(problems);
      await Docs.getDoc(deps.db, id);
      const tab = await deps.rooms.createTab(id, {
        parentTabId,
        title,
        markdown,
        origin: str(body.clientId),
      });
      return json({ tab }, 201);
    }

    if (resource === "tabs" && id && !sub && method === "GET") {
      return json({ tab: await Docs.getTab(deps.db, id) });
    }

    if (resource === "tabs" && id && sub === "export.md" && method === "GET") {
      const tab = await Docs.getTab(deps.db, id);
      return Export.markdownResponse(Export.tabMarkdown(tab), tab.title);
    }

    if (resource === "tabs" && id && !sub && method === "PATCH") {
      const body = await readJson(request);
      const baseVersion = body.baseVersion;
      if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion)) {
        return error(400, "invalid_base_version");
      }
      const markdown = typeof body.markdown === "string" ? body.markdown : undefined;
      if (markdown !== undefined && markdown.length > MAX_MARKDOWN_LENGTH) {
        return error(413, "too_large");
      }
      const title = body.title === undefined ? undefined : str(body.title);
      if (title === null) return error(400, "invalid_title");
      if (markdown === undefined && title === undefined) return error(400, "empty_write");
      const current = await Docs.getTab(deps.db, id);
      const problems = markdown === undefined ? null : widgetProblems(markdown, current.markdown);
      if (problems) return widgetInvalid(problems);
      const result = await deps.rooms.writeTab(current.docId, {
        tabId: id,
        baseVersion,
        ...(markdown === undefined ? {} : { markdown }),
        ...(title === undefined ? {} : { title }),
        origin: str(body.clientId),
      });
      return result.ok
        ? json({ tab: result.tab })
        : json({ error: "version_conflict", tab: result.conflict }, 409);
    }

    if (resource === "tabs" && id && sub === "move" && method === "POST") {
      const body = await readJson(request);
      const parentTabId = body.parentTabId === undefined ? null : body.parentTabId;
      if (parentTabId !== null && typeof parentTabId !== "string") {
        return error(400, "invalid_parent");
      }
      const position = body.position;
      if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
        return error(400, "invalid_position");
      }
      const current = await Docs.getTab(deps.db, id);
      const placements = await deps.rooms.moveTab(current.docId, {
        tabId: id,
        parentTabId,
        position,
        origin: str(body.clientId),
      });
      return json({ placements });
    }

    if (resource === "tabs" && id && !sub && method === "DELETE") {
      const current = await Docs.getTab(deps.db, id);
      const tabIds = await deps.rooms.deleteTab(current.docId, {
        tabId: id,
        origin: url.searchParams.get("clientId"),
      });
      return json({ tabIds });
    }

    const response = await handleComments(
      request,
      { resource, id, sub, method, url, principal },
      deps,
    );
    if (response) return response;

    return error(404, "not_found");
  } catch (cause) {
    if (cause instanceof Docs.NotFoundError) return error(404, "not_found");
    if (cause instanceof Docs.InvalidMoveError) return error(400, "invalid_move");
    if (cause instanceof Docs.LastTabError) return error(409, "last_tab");
    throw cause;
  }
}

/**
 * Threads started from a doc. Only the owner's session links or unlinks them:
 * links come from T3 Code's embed of this app, and an agent token has no
 * T3 Code thread of its own to vouch for.
 */
async function handleDocThreads(
  request: Request,
  route: {
    readonly id: string;
    readonly subId: string | undefined;
    readonly method: string;
    readonly url: URL;
    readonly principal: Auth.Principal;
  },
  deps: ApiDeps,
): Promise<Response | null> {
  const { id, subId, method } = route;
  if (!subId && method === "GET") {
    await Docs.getDoc(deps.db, id);
    return json({ threads: await DocThreads.listDocThreads(deps.db, id) });
  }
  if (method !== "POST" && method !== "DELETE") return null;
  if (route.principal.kind !== "session") return error(403, "session_required");

  if (!subId && method === "POST") {
    const body = await readJson(request);
    const environmentId = str(body.environmentId);
    const threadId = str(body.threadId);
    // Thread titles can run long; the label only needs a recognisable start.
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!environmentId || !threadId || !title) return error(400, "invalid_thread");
    await Docs.getDoc(deps.db, id);
    const threads = await deps.rooms.threadOp(id, {
      op: { kind: "link", environmentId, threadId, title },
      origin: str(body.clientId),
    });
    return json({ threads }, 201);
  }

  if (subId && method === "DELETE") {
    const threads = await deps.rooms.threadOp(id, {
      op: { kind: "unlink", linkId: subId },
      origin: route.url.searchParams.get("clientId"),
    });
    return json({ threads });
  }
  return null;
}

const commentActor = (principal: Auth.Principal): Comments.CommentActor =>
  principal.kind === "session"
    ? { kind: "owner", email: principal.email }
    : { kind: "agent", name: principal.tokenName };

/** Exact text, not trimmed: anchors must match the tab character for character. */
const anchorText = (value: unknown, max: number, required: boolean): string | null => {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max) return null;
  return required && value.trim().length === 0 ? null : value;
};

/** Comment routes; returns null when the path is not one of them. */
async function handleComments(
  request: Request,
  route: {
    readonly resource: string | undefined;
    readonly id: string | undefined;
    readonly sub: string | undefined;
    readonly method: string;
    readonly url: URL;
    readonly principal: Auth.Principal;
  },
  deps: ApiDeps,
): Promise<Response | null> {
  const { resource, id, sub, method, url } = route;
  const actor = commentActor(route.principal);

  if (resource === "docs" && id && sub === "comments" && method === "GET") {
    await Docs.getDoc(deps.db, id);
    const tabId = url.searchParams.get("tabId") ?? undefined;
    return json({ comments: await Comments.listComments(deps.db, { docId: id, tabId }) });
  }

  if (resource === "tabs" && id && sub === "comments" && method === "POST") {
    const body = await readJson(request);
    const quote = anchorText(body.quote, Comments.MAX_QUOTE_LENGTH, true);
    const prefix = anchorText(body.prefix, Comments.MAX_CONTEXT_LENGTH, false);
    const suffix = anchorText(body.suffix, Comments.MAX_CONTEXT_LENGTH, false);
    if (quote === null || prefix === null || suffix === null) return error(400, "invalid_anchor");
    const text = str(body.body, Comments.MAX_COMMENT_LENGTH);
    if (!text) return error(400, "invalid_body");
    const tab = await Docs.getTab(deps.db, id);
    // Imports ask for this so a comment whose passage is gone is reported, not stored detached.
    if (
      body.requireAnchor === true &&
      !locateAnchor(markdownToText(tab.markdown), { quote, prefix, suffix })
    ) {
      return error(409, "anchor_not_found");
    }
    const result = await deps.rooms.commentOp(tab.docId, {
      op: {
        kind: "create",
        tabId: id,
        anchor: { quote, prefix, suffix },
        body: text,
        author: Comments.actorAuthor(actor),
      },
      origin: str(body.clientId),
    });
    return json(result, 201);
  }

  if (resource !== "comments" || !id) return null;
  const existing = await Comments.getComment(deps.db, id);

  if (sub === "replies" && method === "POST") {
    const body = await readJson(request);
    const text = str(body.body, Comments.MAX_COMMENT_LENGTH);
    if (!text) return error(400, "invalid_body");
    const result = await deps.rooms.commentOp(existing.docId, {
      op: { kind: "reply", commentId: id, body: text, author: Comments.actorAuthor(actor) },
      origin: str(body.clientId),
    });
    return json(result, 201);
  }

  if (!sub && method === "PATCH") {
    if (!Comments.canEditComment(actor, existing)) return error(403, "forbidden");
    const body = await readJson(request);
    const text = str(body.body, Comments.MAX_COMMENT_LENGTH);
    if (!text) return error(400, "invalid_body");
    const result = await deps.rooms.commentOp(existing.docId, {
      op: { kind: "edit", commentId: id, body: text },
      origin: str(body.clientId),
    });
    return json(result);
  }

  if ((sub === "resolve" || sub === "reopen") && method === "POST") {
    const body = await readJson(request);
    const result = await deps.rooms.commentOp(existing.docId, {
      op: { kind: "resolve", commentId: id, resolved: sub === "resolve" },
      origin: str(body.clientId),
    });
    return json(result);
  }

  if (!sub && method === "DELETE") {
    if (!Comments.canDeleteComment(actor, existing)) return error(403, "forbidden");
    const result = await deps.rooms.commentOp(existing.docId, {
      op: { kind: "delete", commentId: id },
      origin: url.searchParams.get("clientId"),
    });
    return json(result);
  }

  return null;
}

async function handleAuth(request: Request, path: string, deps: ApiDeps): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed");
  if (!isSameOriginWrite(request, deps)) return error(403, "forbidden_origin");
  const body = await readJson(request);
  const now = deps.now();

  if (path === "/api/auth/request-code") {
    const email = str(body.email, 320);
    if (!email) return error(400, "invalid_email");
    const code = await Auth.issueLoginCode(deps.db, { email, owners: deps.owners, now });
    // Delivery happens after the response so owners and strangers answer alike.
    if (code) deps.waitUntil(deps.sendLoginCode(Auth.normalizeEmail(email), code));
    return json({ ok: true });
  }

  if (path === "/api/auth/verify") {
    const email = str(body.email, 320);
    const code = str(body.code, 12);
    if (!email || !code) return error(401, "invalid_code");
    const token = await Auth.verifyLoginCode(deps.db, { email, code, owners: deps.owners, now });
    if (!token) return error(401, "invalid_code");
    return json({ email: Auth.normalizeEmail(email) }, 200, {
      "Set-Cookie": Auth.sessionCookie(token, Auth.SESSION_TTL_MS),
    });
  }

  if (path === "/api/auth/logout") {
    const token = Auth.readCookie(request, Auth.SESSION_COOKIE);
    if (token) await Auth.deleteSession(deps.db, token);
    return json({ ok: true }, 200, { "Set-Cookie": Auth.sessionCookie("", 0) });
  }

  return error(404, "not_found");
}
