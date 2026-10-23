import type {
  AccessibleLibraryProject,
  DocMember,
  DocRole,
  DocView,
  Me,
  UserSummary,
} from "../shared/access.ts";
import type { DocAnchor } from "../shared/anchors.ts";
import type {
  ApiTokenSummary,
  Comment,
  DocStatus,
  DocSummary,
  DocThreadLink,
  DocWithTabs,
  Project,
  Tab,
  TabPlacement,
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
  me: () => request<Me>("GET", "/api/me"),
  setName: (name: string) => request<Me>("PATCH", "/api/me", { name }),
  /** People on any doc the caller is on, for the share picker. */
  people: () =>
    request<{ people: Array<Pick<UserSummary, "name" | "email">> }>("GET", "/api/people"),
  requestCode: (email: string) =>
    request<{ ok: true }>("POST", "/api/auth/request-code", { email }),
  verifyCode: (email: string, code: string) =>
    request<{ email: string }>("POST", "/api/auth/verify", { email, code }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  library: () => request<{ projects: Array<AccessibleLibraryProject> }>("GET", "/api/library"),
  createProject: (name: string) => request<{ project: Project }>("POST", "/api/projects", { name }),
  createDoc: (projectId: string, title: string) =>
    request<DocWithTabs>("POST", "/api/docs", { projectId, title }),
  doc: (docId: string) => request<DocView>("GET", `/api/docs/${docId}`),
  members: (docId: string) =>
    request<{ members: Array<DocMember> }>("GET", `/api/docs/${docId}/members`),
  /** Adds the person, or changes their role if they already have access. */
  shareDoc: (docId: string, input: { email: string; role: DocRole }) =>
    request<{ member: DocMember; members: Array<DocMember> }>(
      "POST",
      `/api/docs/${docId}/members`,
      input,
    ),
  setMemberRole: (docId: string, memberId: string, role: DocRole) =>
    request<{ member: DocMember; members: Array<DocMember> }>(
      "PATCH",
      `/api/docs/${docId}/members/${memberId}`,
      { role },
    ),
  removeMember: (docId: string, memberId: string) =>
    request<{ members: Array<DocMember> }>("DELETE", `/api/docs/${docId}/members/${memberId}`),
  setDocStatus: (docId: string, status: DocStatus) =>
    request<{ doc: DocSummary }>("PATCH", `/api/docs/${docId}`, { status, clientId }),
  renameDoc: (docId: string, title: string) =>
    request<{ doc: DocSummary }>("PATCH", `/api/docs/${docId}`, { title, clientId }),
  /** Owner only; removes the doc, its tabs, comments, people and images. */
  deleteDoc: (docId: string) =>
    request<{ ok: true }>("DELETE", `/api/docs/${docId}?clientId=${encodeURIComponent(clientId)}`),
  uploadImage: async (docId: string, file: File): Promise<string> => {
    const response = await fetch(`/api/docs/${docId}/images`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok || !data.url) throw new ApiError(response.status, data);
    return data.url;
  },
  docThreads: (docId: string) =>
    request<{ threads: Array<DocThreadLink> }>("GET", `/api/docs/${docId}/threads`),
  linkThread: (docId: string, input: { environmentId: string; threadId: string; title: string }) =>
    request<{ threads: Array<DocThreadLink> }>("POST", `/api/docs/${docId}/threads`, {
      ...input,
      clientId,
    }),
  unlinkThread: (docId: string, linkId: string) =>
    request<{ threads: Array<DocThreadLink> }>(
      "DELETE",
      `/api/docs/${docId}/threads/${linkId}?clientId=${encodeURIComponent(clientId)}`,
    ),
  tab: (tabId: string) => request<{ tab: Tab }>("GET", `/api/tabs/${tabId}`),
  createTab: (docId: string, input: { title: string; parentTabId?: string | null }) =>
    request<{ tab: Tab }>("POST", `/api/docs/${docId}/tabs`, { ...input, clientId }),
  writeTab: (tabId: string, input: { baseVersion: number; markdown?: string; title?: string }) =>
    request<{ tab: Tab }>("PATCH", `/api/tabs/${tabId}`, { ...input, clientId }),
  moveTab: (tabId: string, input: { parentTabId: string | null; position: number }) =>
    request<{ placements: Array<TabPlacement> }>("POST", `/api/tabs/${tabId}/move`, {
      ...input,
      clientId,
    }),
  deleteTab: (tabId: string) =>
    request<{ tabIds: Array<string> }>(
      "DELETE",
      `/api/tabs/${tabId}?clientId=${encodeURIComponent(clientId)}`,
    ),
  comments: (docId: string) =>
    request<{ comments: Array<Comment> }>("GET", `/api/docs/${docId}/comments`),
  createComment: (tabId: string, input: DocAnchor & { body: string }) =>
    request<{ comment: Comment }>("POST", `/api/tabs/${tabId}/comments`, { ...input, clientId }),
  replyComment: (commentId: string, body: string) =>
    request<{ comment: Comment }>("POST", `/api/comments/${commentId}/replies`, {
      body,
      clientId,
    }),
  setCommentResolved: (commentId: string, resolved: boolean) =>
    request<{ comment: Comment }>(
      "POST",
      `/api/comments/${commentId}/${resolved ? "resolve" : "reopen"}`,
      { clientId },
    ),
  deleteComment: (commentId: string) =>
    request<{ commentIds: Array<string> }>(
      "DELETE",
      `/api/comments/${commentId}?clientId=${encodeURIComponent(clientId)}`,
    ),
  tokens: () => request<{ tokens: Array<ApiTokenSummary> }>("GET", "/api/tokens"),
  createToken: (name: string) =>
    request<{ id: string; token: string }>("POST", "/api/tokens", { name }),
  revokeToken: (id: string) => request<{ ok: true }>("DELETE", `/api/tokens/${id}`),
};
