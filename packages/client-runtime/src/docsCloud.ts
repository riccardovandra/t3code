import type { McpServerEntry, McpServerId, McpServerUpsertInput } from "@t3tools/contracts";
import { compactDynamicToolOutput, type DocsCloudReference } from "@t3tools/shared/toolOutput";

/**
 * Docs Cloud is configured by its MCP hub entry: the entry's URL gives the
 * app's origin, and its header secret is the bearer token. Removing the entry
 * turns Docs Cloud off everywhere.
 */
const DOCS_CLOUD_SERVER_NAME = "docs-cloud";
export const DEFAULT_DOCS_CLOUD_URL = "https://docs.upliftedconsulting.com";

export interface DocsCloudConfig {
  readonly serverId: McpServerId;
  /** The app's origin, such as `https://docs.upliftedconsulting.com`. */
  readonly baseUrl: string;
  readonly enabled: boolean;
}

export function docsCloudConfig(servers: ReadonlyArray<McpServerEntry>): DocsCloudConfig | null {
  const entry = servers.find((server) => server.name === DOCS_CLOUD_SERVER_NAME);
  if (!entry || entry.transport.type !== "http") return null;
  const baseUrl = docsCloudOrigin(entry.transport.url);
  return baseUrl === null ? null : { serverId: entry.id, baseUrl, enabled: entry.enabled };
}

/**
 * The origin the Docs panel embeds, or null while the entry is missing or
 * disabled. Agents only get Docs Cloud from an enabled entry, so a disabled
 * one leaves both on the project's markdown files.
 */
export function docsCloudBaseUrl(servers: ReadonlyArray<McpServerEntry>): string | null {
  const config = docsCloudConfig(servers);
  return config?.enabled ? config.baseUrl : null;
}

function docsCloudOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function docsCloudUpsertInput(input: {
  readonly baseUrl: string;
  readonly token: string;
  readonly existing: DocsCloudConfig | null;
}):
  | { readonly ok: true; readonly input: McpServerUpsertInput }
  | { readonly ok: false; readonly error: string } {
  const baseUrl = docsCloudOrigin(input.baseUrl);
  if (baseUrl === null) return { ok: false, error: "Enter the Docs Cloud URL, such as https://…" };
  const token = input.token.trim().replace(/^bearer\s+/i, "");
  if (token === "" && input.existing === null) {
    return { ok: false, error: "Paste an API token from Docs Cloud Settings." };
  }
  return {
    ok: true,
    input: {
      ...(input.existing ? { id: input.existing.serverId } : {}),
      name: DOCS_CLOUD_SERVER_NAME,
      transport: { type: "http", url: `${baseUrl}/mcp` },
      // An empty token keeps the stored one.
      auth: {
        type: "header",
        header: "Authorization",
        ...(token ? { secret: `Bearer ${token}` } : {}),
      },
    },
  };
}

/** The app path for a Docs Cloud URL, or null when it belongs to another origin. */
export function docsCloudPath(url: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(baseUrl).origin ? parsed.pathname : null;
  } catch {
    return null;
  }
}

const DOCS_CLOUD_TOOLS = ["create_doc", "create_tab"] as const;
type DocsCloudToolName = (typeof DOCS_CLOUD_TOOLS)[number];

/**
 * Providers spell an upstream tool differently: `mcp__docs-cloud__create_doc`
 * (Claude), `docs-cloud.create_doc` (Codex), `t3-mcp-1a2b3c4d-docs-cloud_create_doc`
 * (OpenCode's per-thread prefix), or the bare name. The result's URL must also be on the
 * configured origin, so a same-named tool elsewhere cannot open the panel.
 */
function docsCloudToolName(toolName: string | null | undefined): DocsCloudToolName | null {
  const name = toolName?.trim().toLowerCase();
  if (!name) return null;
  const tool = DOCS_CLOUD_TOOLS.find((candidate) => name.endsWith(candidate));
  if (!tool) return null;
  const server = name
    .slice(0, -tool.length)
    .replace(/^mcp(__|-|_)/, "")
    .replace(/^t3-mcp-[0-9a-f]{8}-/, "")
    .replace(/[\s._:/·-]+$/, "")
    .replace(/_/g, "-");
  return server === "" || server === DOCS_CLOUD_SERVER_NAME ? tool : null;
}

export interface DocsCloudToolResult {
  readonly kind: "doc-created" | "tab-added";
  readonly ref: DocsCloudReference;
}

/** The doc or tab a completed Docs Cloud create_doc or create_tab call made. */
export function docsCloudToolResult(item: {
  readonly toolName: string | null | undefined;
  readonly status: string;
  readonly output?: unknown;
}): DocsCloudToolResult | null {
  if (item.status !== "completed") return null;
  const tool = docsCloudToolName(item.toolName);
  if (tool === null) return null;
  const output = compactDynamicToolOutput(item.output);
  const ref = output?.isError ? undefined : output?.docsCloud;
  if (!ref) return null;
  if (tool === "create_tab") return { kind: "tab-added", ref };
  return ref.docTitle === undefined ? null : { kind: "doc-created", ref };
}

/** Like docsCloudToolResult, but only for the configured Docs Cloud, with the app path to open. */
export function docsCloudToolEvent(
  item: Parameters<typeof docsCloudToolResult>[0],
  baseUrl: string,
): (DocsCloudToolResult & { readonly path: string }) | null {
  const result = docsCloudToolResult(item);
  const path = result ? docsCloudPath(result.ref.url, baseUrl) : null;
  return result && path !== null ? { ...result, path } : null;
}

/** A thread by the environment that owns it, as the Docs Cloud embed names it. */
export interface DocsCloudThreadRef {
  readonly environmentId: string;
  readonly threadId: string;
}

export interface DocsCloudStartWork {
  readonly docId: string;
  readonly tabId: string | null;
  readonly title: string;
  readonly url: string;
}

export interface DocsCloudCommentEntry {
  readonly id: string;
  readonly author: "user" | "agent";
  readonly body: string;
}

export interface DocsCloudCommentSend {
  readonly requestId: string;
  readonly docId: string;
  readonly tabId: string;
  readonly docTitle: string;
  readonly url: string;
  readonly commentId: string;
  readonly quote: string;
  readonly entries: ReadonlyArray<DocsCloudCommentEntry>;
}

/** Copy the doc into another app; T3 Code answers with `sent-to` and the same requestId. */
export interface DocsCloudSendToRequest {
  readonly requestId: string;
  readonly target: "notion";
  readonly docId: string;
  readonly title: string;
  readonly url: string;
}

/** The Docs Cloud frame's requests that T3 Code acts on beyond `location`. */
export type DocsCloudFrameRequest =
  | ({ readonly type: "t3-docs:start-work" } & DocsCloudStartWork)
  | {
      readonly type: "t3-docs:resolve-threads";
      readonly threads: ReadonlyArray<DocsCloudThreadRef>;
    }
  | ({ readonly type: "t3-docs:open-thread" } & DocsCloudThreadRef)
  | ({ readonly type: "t3-docs:thread-linked"; readonly docId: string } & DocsCloudThreadRef)
  | ({ readonly type: "t3-docs:send-comment" } & DocsCloudCommentSend)
  | ({ readonly type: "t3-docs:send-to" } & DocsCloudSendToRequest);

const DOCS_CLOUD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isId = (value: unknown): value is string =>
  typeof value === "string" && DOCS_CLOUD_ID.test(value);
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const isRef = (value: unknown): value is DocsCloudThreadRef => {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    isText(ref.environmentId, 200) &&
    ref.environmentId !== "" &&
    isText(ref.threadId, 200) &&
    ref.threadId !== ""
  );
};

/** True when `url` is the doc's own page (optionally at a tab) on the Docs Cloud origin. */
function isDocUrl(
  url: unknown,
  origin: string,
  docId: string,
  tabId: string | null,
): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    const path = tabId === null ? `/d/${docId}` : `/d/${docId}/${tabId}`;
    return parsed.origin === origin && parsed.pathname === path && parsed.search === "";
  } catch {
    return false;
  }
}

/**
 * The frame's request, or null when it is not one or is malformed. Origin and
 * source are the caller's checks. Doc URLs must be the doc's own page on the
 * Docs Cloud origin, because they go into prompts an agent follows.
 */
export function parseDocsCloudFrameRequest(
  value: unknown,
  origin: string,
): DocsCloudFrameRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "t3-docs:start-work": {
      const { docId, title, url } = message;
      const tabId = message.tabId ?? null;
      if (!isId(docId) || (tabId !== null && !isId(tabId)) || !isText(title, 500)) return null;
      if (!isDocUrl(url, origin, docId, tabId)) return null;
      return { type: message.type, docId, tabId, title: title.trim() || "Untitled", url };
    }
    case "t3-docs:resolve-threads":
      return Array.isArray(message.threads) && message.threads.length <= 200
        ? {
            type: message.type,
            threads: message.threads
              .filter(isRef)
              .map(({ environmentId, threadId }) => ({ environmentId, threadId })),
          }
        : null;
    case "t3-docs:open-thread":
      return isRef(message)
        ? { type: message.type, environmentId: message.environmentId, threadId: message.threadId }
        : null;
    case "t3-docs:thread-linked":
      return isId(message.docId) && isRef(message)
        ? {
            type: message.type,
            docId: message.docId,
            environmentId: message.environmentId,
            threadId: message.threadId,
          }
        : null;
    case "t3-docs:send-comment": {
      const { requestId, docId, tabId, docTitle, url, commentId, quote, entries } = message;
      if (!isId(requestId) || !isId(docId) || !isId(tabId) || !isId(commentId)) return null;
      if (!isText(docTitle, 500) || !isText(quote, 2_000)) return null;
      if (!isDocUrl(url, origin, docId, tabId)) return null;
      if (!Array.isArray(entries) || entries.length === 0 || entries.length > 200) return null;
      const parsed: Array<DocsCloudCommentEntry> = [];
      for (const entry of entries as Array<Record<string, unknown>>) {
        if (typeof entry !== "object" || entry === null || !isId(entry.id)) return null;
        if (entry.author !== "user" && entry.author !== "agent") return null;
        if (!isText(entry.body, 10_000)) return null;
        parsed.push({ id: entry.id, author: entry.author, body: entry.body });
      }
      return {
        type: message.type,
        requestId,
        docId,
        tabId,
        docTitle,
        url,
        commentId,
        quote,
        entries: parsed,
      };
    }
    case "t3-docs:send-to": {
      const { requestId, target, docId, title, url } = message;
      if (!isId(requestId) || target !== "notion" || !isId(docId) || !isText(title, 500)) {
        return null;
      }
      if (!isDocUrl(url, origin, docId, null)) return null;
      return {
        type: message.type,
        requestId,
        target,
        docId,
        title: title.trim() || "Untitled",
        url,
      };
    }
    default:
      return null;
  }
}

/**
 * The drafted first message of a thread started from a doc. The doc is the
 * plan, so the agent reads all of it through the docs-cloud tools rather than
 * a pasted copy that would go stale.
 */
export function docsCloudWorkBrief(work: DocsCloudStartWork): string {
  return [
    `Work from the Docs Cloud doc ${JSON.stringify(work.title)}: ${work.url}`,
    "",
    `Read the whole doc first with the docs-cloud read_doc tool (docId: "${work.docId}", no tabId) and treat it as the plan for this thread.${work.tabId === null ? "" : ` I started from the tab with id "${work.tabId}".`} Follow its steps and decisions, and check with me before departing from them.`,
    `When you begin, set the doc's status to in_progress with set_doc_status. Keep the doc current as the work changes the plan, and set it to done only when I confirm the work is finished.`,
  ].join("\n");
}
