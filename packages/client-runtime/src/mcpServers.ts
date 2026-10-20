import {
  MCP_CLIENT_OAUTH_CALLBACK_PATH,
  RESERVED_MCP_SERVER_NAMES,
  type McpServerConfig,
  type McpServerEntry,
  type McpServerId,
  type McpServerStatus,
  type McpServerUpsertInput,
} from "@t3tools/contracts";
import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";

export const MCP_SERVERS_UNSUPPORTED_MESSAGE =
  "This environment runs an older T3 server without MCP server support. Update its server to manage MCP servers here.";

export type McpServerStatusTone = "success" | "warning" | "error" | "muted";

export interface McpServerStatusPresentation {
  readonly label: string;
  readonly tone: McpServerStatusTone;
  readonly detail: string | null;
}

export function mcpServerStatusPresentation(status: McpServerStatus): McpServerStatusPresentation {
  switch (status.state) {
    case "connected":
      return { label: "Connected", tone: "success", detail: null };
    case "needs-sign-in":
      return {
        label: "Needs sign-in",
        tone: "warning",
        detail: "Sign in before agents can use this server.",
      };
    case "error":
      return { label: "Error", tone: "error", detail: status.message };
    case "disabled":
      return { label: "Disabled", tone: "muted", detail: null };
    case "idle":
      return { label: "Not connected yet", tone: "muted", detail: null };
  }
}

export function mcpServerTransportSummary(server: Pick<McpServerConfig, "transport">): string {
  const { transport } = server;
  if (transport.type === "http") return transport.url;
  return [transport.command, ...transport.args].join(" ");
}

/** OAuth servers offer sign-in until they hold tokens, and sign-out once they might. */
export function mcpServerAuthAction(entry: McpServerEntry): "sign-in" | "sign-out" | null {
  if (entry.auth.type !== "oauth") return null;
  return entry.status.state === "needs-sign-in" ? "sign-in" : "sign-out";
}

export interface McpOAuthRedirect {
  readonly uri: string;
  readonly note: string | null;
}

/** The redirect URI to register with a provider, on the address this client reaches the server. */
export function mcpOAuthRedirect(httpBaseUrl: string | null): McpOAuthRedirect | null {
  if (httpBaseUrl === null) return null;
  let url: URL;
  try {
    url = new URL(MCP_CLIENT_OAUTH_CALLBACK_PATH, httpBaseUrl);
  } catch {
    return null;
  }
  return {
    uri: `${url.origin}${MCP_CLIENT_OAUTH_CALLBACK_PATH}`,
    note: isLocalLoopbackHost(url.hostname)
      ? "Some providers reject localhost. Open T3 Code on its tailnet or T3 Connect address to get one they accept."
      : null,
  };
}

export interface McpServerEnvDraft {
  readonly key: string;
  readonly value: string;
  readonly secret: boolean;
  /** A secret the server already holds; an empty value keeps it. */
  readonly stored: boolean;
}

export interface McpServerDraft {
  readonly id: McpServerId | null;
  readonly name: string;
  readonly enabled: boolean;
  readonly transport: "http" | "stdio";
  readonly url: string;
  readonly command: string;
  /** One argument per line, so arguments may contain spaces. */
  readonly args: string;
  readonly env: ReadonlyArray<McpServerEnvDraft>;
  readonly auth: "none" | "header" | "oauth";
  readonly header: string;
  readonly headerValue: string;
  readonly headerStored: boolean;
  readonly registeredClient: boolean;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly clientSecretStored: boolean;
}

export function mcpServerDraft(entry: McpServerConfig | null): McpServerDraft {
  const transport = entry?.transport;
  const auth = entry?.auth;
  const client = auth?.type === "oauth" ? auth.client : undefined;
  return {
    id: entry?.id ?? null,
    name: entry?.name ?? "",
    enabled: entry?.enabled ?? true,
    transport: transport?.type ?? "http",
    url: transport?.type === "http" ? transport.url : "",
    command: transport?.type === "stdio" ? transport.command : "",
    args: transport?.type === "stdio" ? transport.args.join("\n") : "",
    env:
      transport?.type === "stdio"
        ? [
            ...Object.entries(transport.env).map(([key, value]) => ({
              key,
              value,
              secret: false,
              stored: false,
            })),
            ...transport.secretEnv.map((key) => ({ key, value: "", secret: true, stored: true })),
          ]
        : [],
    auth: auth?.type ?? "none",
    header: auth?.type === "header" ? auth.header : "Authorization",
    headerValue: "",
    headerStored: auth?.type === "header",
    registeredClient: client !== undefined,
    clientId: client?.clientId ?? "",
    clientSecret: "",
    clientSecretStored: client?.hasClientSecret ?? false,
  };
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER_PATTERN = /^[A-Za-z0-9-]{1,128}$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

export type McpServerDraftResult =
  | { readonly ok: true; readonly input: McpServerUpsertInput }
  | { readonly ok: false; readonly error: string };

const invalid = (error: string): McpServerDraftResult => ({ ok: false, error });

export function mcpServerUpsertInput(
  draft: McpServerDraft,
  redirectUri: string | null,
): McpServerDraftResult {
  const name = draft.name.trim();
  if (!NAME_PATTERN.test(name)) {
    return invalid("Use lowercase letters, digits, '-' and '_' for the name.");
  }
  if (RESERVED_MCP_SERVER_NAMES.has(name)) {
    return invalid("That name is reserved for T3 Code's own MCP server.");
  }
  const base = { ...(draft.id === null ? {} : { id: draft.id }), name, enabled: draft.enabled };

  if (draft.transport === "stdio") {
    const command = draft.command.trim();
    if (command === "") return invalid("Enter the command that starts the server.");
    const env: Record<string, string> = {};
    const secretEnv: Record<string, { secret?: string }> = {};
    for (const entry of draft.env) {
      const key = entry.key.trim();
      if (key === "" && entry.value === "") continue;
      if (!ENV_NAME_PATTERN.test(key)) return invalid(`"${key}" is not a valid variable name.`);
      if (key in env || key in secretEnv) return invalid(`${key} is set twice.`);
      if (!entry.secret) {
        env[key] = entry.value;
      } else if (entry.value.trim() !== "") {
        secretEnv[key] = { secret: entry.value.trim() };
      } else if (entry.stored) {
        secretEnv[key] = {};
      } else {
        return invalid(`Enter a value for ${key}.`);
      }
    }
    return {
      ok: true,
      input: {
        ...base,
        transport: {
          type: "stdio",
          command,
          args: draft.args.split("\n").filter((arg) => arg.trim() !== ""),
          env,
          secretEnv,
        },
        auth: { type: "none" },
      },
    };
  }

  const url = draft.url.trim();
  if (!URL_PATTERN.test(url)) return invalid("Enter the server's http:// or https:// URL.");
  const transport = { type: "http" as const, url };

  if (draft.auth === "header") {
    const header = draft.header.trim();
    if (!HEADER_PATTERN.test(header)) return invalid("Enter a header name, such as Authorization.");
    const value = draft.headerValue.trim();
    if (value === "" && !draft.headerStored) return invalid("Enter the header value.");
    return {
      ok: true,
      input: {
        ...base,
        transport,
        auth: { type: "header", header, ...(value === "" ? {} : { secret: value }) },
      },
    };
  }

  if (draft.auth === "oauth") {
    if (!draft.registeredClient) {
      return { ok: true, input: { ...base, transport, auth: { type: "oauth" } } };
    }
    const clientId = draft.clientId.trim();
    if (clientId === "") return invalid("Enter the client ID you registered with the provider.");
    if (redirectUri === null) {
      return invalid("This environment's address is unknown, so there is no redirect URI.");
    }
    const clientSecret = draft.clientSecret.trim();
    return {
      ok: true,
      input: {
        ...base,
        transport,
        auth: {
          type: "oauth",
          client: {
            clientId,
            redirectUri,
            ...(clientSecret === "" ? {} : { clientSecret: { secret: clientSecret } }),
          },
        },
      },
    };
  }

  return { ok: true, input: { ...base, transport, auth: { type: "none" } } };
}

/** Saving drops a stored sign-in when the URL or registered client changes. */
export function mcpServerDraftDropsSignIn(
  entry: McpServerConfig | null,
  draft: McpServerDraft,
): boolean {
  if (entry === null || entry.auth.type !== "oauth" || entry.transport.type !== "http") {
    return false;
  }
  if (draft.transport !== "http" || draft.auth !== "oauth") return true;
  const clientId = draft.registeredClient ? draft.clientId.trim() : undefined;
  return draft.url.trim() !== entry.transport.url || clientId !== entry.auth.client?.clientId;
}
