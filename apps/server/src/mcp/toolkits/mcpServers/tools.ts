import {
  McpServerEntry,
  McpServerListResult,
  McpServerRemoveInput,
  McpServerSetEnabledInput,
  McpServerSignInInput,
  McpServerSignInResult,
  McpServerSignOutInput,
  McpServerUpsertInput,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as McpServerOAuth from "../../../mcpHub/McpServerOAuth.ts";
import * as McpServerRegistry from "../../../mcpHub/McpServerRegistry.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../../../secrets/SecretRequests.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    McpServerRegistry.McpServerRegistry,
    McpServerOAuth.McpServerOAuth,
    SecretRequests.SecretRequests,
    ServerConfig.ServerConfig,
  ],
};

const McpServersListTool = Tool.make("mcp_servers_list", {
  ...shared,
  description:
    "List the MCP servers configured in T3 Code, with transport, auth type and status (idle, connected, needs-sign-in, error or disabled). Secret values are never returned.",
  success: McpServerListResult,
})
  .annotate(Tool.Title, "List MCP servers")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const McpServerUpsertTool = Tool.make("mcp_server_upsert", {
  ...shared,
  description:
    "Add an MCP server to T3 Code, or update one by id. Use transport http with the server's URL, or stdio with a command. For a header credential or secret environment variable, ask the user with request_secret and pass the returned secretRef; never ask for a secret in chat. Omit a secret to keep the stored one.",
  parameters: McpServerUpsertInput,
  success: Schema.Struct({ server: McpServerEntry }),
})
  .annotate(Tool.Title, "Add or update an MCP server")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const McpServerRemoveTool = Tool.make("mcp_server_remove", {
  ...shared,
  description: "Remove an MCP server from T3 Code and delete its stored secrets.",
  parameters: McpServerRemoveInput,
  success: Schema.Struct({}),
})
  .annotate(Tool.Title, "Remove an MCP server")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const McpServerSetEnabledTool = Tool.make("mcp_server_set_enabled", {
  ...shared,
  description: "Enable or disable an MCP server. A disabled server keeps its config and secrets.",
  parameters: McpServerSetEnabledInput,
  success: Schema.Struct({ server: McpServerEntry }),
})
  .annotate(Tool.Title, "Enable or disable an MCP server")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const McpServerStartSignInTool = Tool.make("mcp_server_start_sign_in", {
  ...shared,
  description:
    "Start OAuth sign-in for an MCP server whose auth type is oauth, such as one whose status is needs-sign-in. Returns an authorization URL: give it to the user as a link to open in their browser. It works once and expires after 10 minutes. After the user signs in, the browser returns to T3 Code at callbackOrigin, so pass the T3 Code address the user's browser can reach (such as their tailnet or T3 Connect URL) when it is not this machine. Servers with a registered client always return to its registered redirect URI.",
  parameters: Schema.Struct({
    ...McpServerSignInInput.fields,
    callbackOrigin: Schema.optional(
      Schema.String.check(Schema.isPattern(/^https?:\/\/[^/\s]+\/?$/i)),
    ).annotate({
      description:
        "The T3 Code origin the browser returns to, such as https://host.tailnet.ts.net. Defaults to this server's local address, which only works in a browser on this machine.",
    }),
  }),
  success: McpServerSignInResult,
})
  .annotate(Tool.Title, "Start MCP server sign-in")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const McpServerSignOutTool = Tool.make("mcp_server_sign_out", {
  ...shared,
  description:
    "Sign out of an OAuth MCP server: deletes its stored tokens and client registration. Its status becomes needs-sign-in.",
  parameters: McpServerSignOutInput,
  success: Schema.Struct({ server: McpServerEntry }),
})
  .annotate(Tool.Title, "Sign out of an MCP server")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const McpServersToolkit = Toolkit.make(
  McpServersListTool,
  McpServerUpsertTool,
  McpServerRemoveTool,
  McpServerSetEnabledTool,
  McpServerStartSignInTool,
  McpServerSignOutTool,
);
