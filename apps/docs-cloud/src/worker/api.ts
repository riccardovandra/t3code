import type { Tab } from "../shared/protocol.ts";
import * as Auth from "./auth.ts";
import * as Docs from "./docs.ts";

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
  openSocket(docId: string, request: Request): Promise<Response>;
}

export interface ApiDeps {
  readonly db: D1Database;
  readonly owners: ReadonlySet<string>;
  readonly rooms: DocRooms;
  readonly sendLoginCode: (email: string, code: string) => Promise<void>;
  readonly waitUntil: (promise: Promise<unknown>) => void;
  readonly now: () => number;
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const error = (status: number, code: string) => json({ error: code }, status);

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
function isSameOriginWrite(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) return false;
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
  const [resource, id, sub] = segments;

  // Socket handshakes carry the SameSite=None cookie cross-site too, so a
  // cookie-authed socket must come from this origin.
  if (resource === "docs" && id && sub === "ws" && method === "GET") {
    const origin = request.headers.get("Origin");
    if (principal.kind === "session" && origin !== null && origin !== url.origin) {
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

  if (principal.kind === "session" && !SAFE_METHODS.has(method) && !isSameOriginWrite(request)) {
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

    if (resource === "docs" && id && sub === "tabs" && method === "POST") {
      const body = await readJson(request);
      const title = str(body.title) ?? "Untitled";
      const parentTabId = body.parentTabId === undefined ? null : body.parentTabId;
      if (parentTabId !== null && typeof parentTabId !== "string") {
        return error(400, "invalid_parent");
      }
      const markdown = typeof body.markdown === "string" ? body.markdown : "";
      if (markdown.length > MAX_MARKDOWN_LENGTH) return error(413, "too_large");
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

    return error(404, "not_found");
  } catch (cause) {
    if (cause instanceof Docs.NotFoundError) return error(404, "not_found");
    throw cause;
  }
}

async function handleAuth(request: Request, path: string, deps: ApiDeps): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed");
  if (!isSameOriginWrite(request)) return error(403, "forbidden_origin");
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
