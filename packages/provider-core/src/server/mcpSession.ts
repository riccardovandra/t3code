import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

/**
 * A user-configured MCP server, reached through T3 Code's forwarding route
 * with the same `authorizationHeader` as `t3-code`. The upstream credential
 * stays on the server and never appears here.
 */
export interface McpUpstreamServerEntry {
  /** A unique lowercase slug that never collides with `t3-code`. */
  readonly name: string;
  readonly endpoint: string;
}

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  /**
   * Adapters read it to keep developer instructions truthful: when the user
   * withholds agent browser access, the prompt must not advertise `preview_*`
   * tools that every call would reject.
   */
  readonly browserToolsAvailable: boolean;
  readonly capabilities?: ReadonlySet<string>;
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
  readonly upstreamServers?: ReadonlyArray<McpUpstreamServerEntry>;
}

const isReadOnlySandbox = (sandboxPolicy: unknown): boolean =>
  typeof sandboxPolicy === "object" &&
  sandboxPolicy !== null &&
  "type" in sandboxPolicy &&
  sandboxPolicy.type === "readOnly";

/**
 * Upstream tools can write anywhere the user's accounts reach, which a
 * read-only sandbox cannot police, so read-only sessions get none.
 */
export function upstreamServersFor(
  config: Pick<McpProviderSessionConfig, "upstreamServers"> | undefined,
  runtimePolicy: { readonly sandboxPolicy?: unknown } | undefined,
): ReadonlyArray<McpUpstreamServerEntry> {
  if (isReadOnlySandbox(runtimePolicy?.sandboxPolicy)) return [];
  return config?.upstreamServers ?? [];
}

export function withAgentDeviceEnvironment(
  base: NodeJS.ProcessEnv,
  config: Pick<McpProviderSessionConfig, "agentDeviceEnvironment"> | undefined,
): NodeJS.ProcessEnv {
  const extra = config?.agentDeviceEnvironment;
  if (!extra) return base;
  const separator = extra.PATH_SEPARATOR ?? ":";
  const basePath = base.PATH ?? base.Path;
  const { PATH: shimDir, PATH_SEPARATOR: _separator, ...rest } = extra;
  return {
    ...base,
    ...rest,
    ...(shimDir ? { PATH: basePath ? `${shimDir}${separator}${basePath}` : shimDir } : {}),
  };
}
