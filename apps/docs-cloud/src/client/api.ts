import type {
  ApiTokenSummary,
  DocWithTabs,
  LibraryProject,
  Project,
  Tab,
} from "../shared/protocol.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly body: { readonly error?: string; readonly tab?: Tab };

  constructor(status: number, body: ApiError["body"]) {
    super(body.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data as ApiError["body"]);
  return data as T;
}

/** Identifies this page's writes, so the DocRoom echo of our own save is recognisable. */
export const clientId = crypto.randomUUID();

export const api = {
  me: () => request<{ email: string }>("GET", "/api/me"),
  requestCode: (email: string) =>
    request<{ ok: true }>("POST", "/api/auth/request-code", { email }),
  verifyCode: (email: string, code: string) =>
    request<{ email: string }>("POST", "/api/auth/verify", { email, code }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  library: () => request<{ projects: Array<LibraryProject> }>("GET", "/api/library"),
  createProject: (name: string) => request<{ project: Project }>("POST", "/api/projects", { name }),
  createDoc: (projectId: string, title: string) =>
    request<DocWithTabs>("POST", "/api/docs", { projectId, title }),
  doc: (docId: string) => request<DocWithTabs>("GET", `/api/docs/${docId}`),
  tab: (tabId: string) => request<{ tab: Tab }>("GET", `/api/tabs/${tabId}`),
  createTab: (docId: string, input: { title: string; parentTabId?: string | null }) =>
    request<{ tab: Tab }>("POST", `/api/docs/${docId}/tabs`, { ...input, clientId }),
  writeTab: (tabId: string, input: { baseVersion: number; markdown?: string; title?: string }) =>
    request<{ tab: Tab }>("PATCH", `/api/tabs/${tabId}`, { ...input, clientId }),
  tokens: () => request<{ tokens: Array<ApiTokenSummary> }>("GET", "/api/tokens"),
  createToken: (name: string) =>
    request<{ id: string; token: string }>("POST", "/api/tokens", { name }),
  revokeToken: (id: string) => request<{ ok: true }>("DELETE", `/api/tokens/${id}`),
};
