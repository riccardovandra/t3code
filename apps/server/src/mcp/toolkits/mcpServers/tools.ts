import {
  McpServerEntry,
  McpServerListResult,
  McpServerRemoveInput,
  McpServerSetEnabledInput,
  McpServerUpsertInput,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

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
    SecretRequests.SecretRequests,
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

export const McpServersToolkit = Toolkit.make(
  McpServersListTool,
  McpServerUpsertTool,
  McpServerRemoveTool,
  McpServerSetEnabledTool,
);
