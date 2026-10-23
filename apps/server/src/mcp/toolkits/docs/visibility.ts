import { McpSchema, type Tool, Toolkit } from "effect/ai";

/** The tools that reach Docs Cloud itself; they stay listed in both configurations. */
const DOCS_CLOUD_TOOL_PREFIX = "docs_cloud_";

/**
 * Hides the local markdown docs tools while `docsCloudConnected` holds. The MCP
 * server checks it on every `tools/list` and `tools/call`, so a hidden tool is
 * neither advertised nor callable.
 */
export const hideLocalDocsToolsWhen = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
  docsCloudConnected: () => boolean,
): Toolkit.Toolkit<Tools> =>
  Toolkit.make(
    ...Object.values(toolkit.tools).map((tool) =>
      tool.name.startsWith(DOCS_CLOUD_TOOL_PREFIX)
        ? tool
        : tool.annotate(McpSchema.EnabledWhen, () => !docsCloudConnected()),
    ),
  ) as unknown as Toolkit.Toolkit<Tools>;
