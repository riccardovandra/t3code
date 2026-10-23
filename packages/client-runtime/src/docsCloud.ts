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
