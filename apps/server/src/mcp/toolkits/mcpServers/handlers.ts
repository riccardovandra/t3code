import { type McpServerError, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ServerConfig from "../../../config.ts";
import * as McpServerOAuth from "../../../mcpHub/McpServerOAuth.ts";
import * as McpServerRegistry from "../../../mcpHub/McpServerRegistry.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { McpServersToolkit } from "./tools.ts";

const toFailure = (error: McpServerError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "read_failed" ||
      error.reason === "write_failed" ||
      error.reason === "secret_failed" ||
      error.reason === "sign_in_failed"
        ? "orchestration_error"
        : "invalid_request",
    message: error.message,
  });

const handlers = {
  mcp_servers_list: McpToolAccess.reads(() =>
    Effect.flatMap(McpServerRegistry.McpServerRegistry, (registry) =>
      registry.list.pipe(Effect.mapError(toFailure)),
    ),
  ),
  // A stdio server is a command this environment runs, so changes need a full-access caller.
  mcp_server_upsert: McpToolAccess.writesEnvironment((input, check) =>
    Effect.gen(function* () {
      const { caller } = yield* check;
      const registry = yield* McpServerRegistry.McpServerRegistry;
      const server = yield* registry
        .upsert(input, caller === undefined ? {} : { projectId: caller.projectId })
        .pipe(Effect.mapError(toFailure));
      return { server };
    }),
  ),
  mcp_server_remove: McpToolAccess.writesEnvironment((input) =>
    Effect.flatMap(McpServerRegistry.McpServerRegistry, (registry) =>
      registry.remove(input).pipe(Effect.as({}), Effect.mapError(toFailure)),
    ),
  ),
  mcp_server_set_enabled: McpToolAccess.writesEnvironment((input) =>
    Effect.flatMap(McpServerRegistry.McpServerRegistry, (registry) =>
      registry.setEnabled(input).pipe(
        Effect.map((server) => ({ server })),
        Effect.mapError(toFailure),
      ),
    ),
  ),
  mcp_server_start_sign_in: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const oauth = yield* McpServerOAuth.McpServerOAuth;
      const { port } = yield* ServerConfig.ServerConfig;
      return yield* oauth
        .startSignIn({
          id: input.id,
          callbackOrigin: input.callbackOrigin ?? `http://127.0.0.1:${port}`,
        })
        .pipe(Effect.mapError(toFailure));
    }),
  ),
  mcp_server_sign_out: McpToolAccess.writesEnvironment((input) =>
    Effect.flatMap(McpServerOAuth.McpServerOAuth, (oauth) =>
      oauth.signOut(input).pipe(
        Effect.map((server) => ({ server })),
        Effect.mapError(toFailure),
      ),
    ),
  ),
} satisfies McpToolAccess.Handlers<typeof McpServersToolkit.tools>;

export const layer = McpToolAccess.toLayer(McpServersToolkit, handlers);
