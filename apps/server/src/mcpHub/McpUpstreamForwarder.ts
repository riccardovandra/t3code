import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type Result,
  type ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import type * as Effect from "effect/Effect";

import type { McpUpstreamError, McpUpstreamSession } from "./McpUpstreamClients.ts";

type RunEffect = <A>(effect: Effect.Effect<A, McpUpstreamError>, signal: AbortSignal) => Promise<A>;

/**
 * Each request gets a stateless server, so the route keeps no per-thread state
 * and any instance can answer. Notifications cannot reach a stateless client,
 * so list-change and subscription capabilities are not advertised.
 */
const advertised = (upstream: ServerCapabilities): ServerCapabilities => ({
  ...(upstream.tools === undefined ? {} : { tools: {} }),
  ...(upstream.resources === undefined ? {} : { resources: {} }),
  ...(upstream.prompts === undefined ? {} : { prompts: {} }),
  ...(upstream.completions === undefined ? {} : { completions: {} }),
});

/**
 * Results pass through untouched, so `_meta` such as an MCP App's
 * `ui.resourceUri` and the `ui://` resources it points at reach the agent as
 * the upstream sent them. Upstream JSON-RPC errors keep their code and message.
 */
export const forwardMcpRequest = async (input: {
  readonly session: McpUpstreamSession;
  readonly request: Request;
  readonly run: RunEffect;
}): Promise<Response> => {
  const { session, run } = input;
  const capabilities = advertised(session.capabilities);
  const server = new Server(
    {
      name: session.serverInfo?.name ?? "upstream",
      version: session.serverInfo?.version ?? "0.0.0",
    },
    {
      capabilities,
      ...(session.instructions === undefined ? {} : { instructions: session.instructions }),
    },
  );
  const forward = (
    method: string,
    params: Record<string, unknown> | undefined,
    signal: AbortSignal,
  ): Promise<Result> =>
    run(session.request(method, params), signal).catch((error: unknown) => {
      const cause = (error as McpUpstreamError | undefined)?.cause;
      if (cause instanceof McpError) throw cause;
      throw new McpError(
        ErrorCode.InternalError,
        error instanceof Error ? error.message : "Could not reach the MCP server.",
      );
    });

  if (capabilities.tools !== undefined) {
    server.setRequestHandler(ListToolsRequestSchema, (request, extra) =>
      forward(request.method, request.params, extra.signal),
    );
    server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
      forward(request.method, request.params, extra.signal),
    );
  }
  if (capabilities.resources !== undefined) {
    server.setRequestHandler(ListResourcesRequestSchema, (request, extra) =>
      forward(request.method, request.params, extra.signal),
    );
    server.setRequestHandler(ListResourceTemplatesRequestSchema, (request, extra) =>
      forward(request.method, request.params, extra.signal),
    );
    server.setRequestHandler(ReadResourceRequestSchema, (request, extra) =>
      forward(request.method, request.params, extra.signal),
    );
  }
  if (capabilities.prompts !== undefined) {
    server.setRequestHandler(ListPromptsRequestSchema, (request, extra) =>
      forward(request.method, request.params, extra.signal),
    );
    server.setRequestHandler(GetPromptRequestSchema, (request, extra) =>
      forward(request.method, request.params, extra.signal),
    );
  }
  if (capabilities.completions !== undefined) {
    server.setRequestHandler(CompleteRequestSchema, (request, extra) =>
      forward(request.method, request.params, extra.signal),
    );
  }

  // No session id generator: stateless mode.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(input.request);
  } finally {
    await server.close();
  }
};
