// @effect-diagnostics-next-line nodeBuiltinImport:off -- the fake upstream is a plain Node HTTP server.
import * as NodeHttp from "node:http";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- reads the fake upstream's bound port.
import type * as NodeNet from "node:net";

import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  EnvironmentId,
  type McpServerId,
  ProviderInstanceId,
  SecretRequestError,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { cast } from "effect/Function";
import * as Layer from "effect/Layer";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as McpServerRegistry from "./McpServerRegistry.ts";
import * as McpUpstreamClients from "./McpUpstreamClients.ts";

const UPSTREAM_KEY = "upstream-api-key";
const UI_RESOURCE = "ui://echo/app.html";

const makeFakeUpstream = () => {
  const server = new Server(
    { name: "fake-upstream", version: "1.2.3" },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: "Use echo." },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "echo",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        _meta: { ui: { resourceUri: UI_RESOURCE } },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    if (request.params.name !== "echo") {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    }
    const text = String(request.params.arguments?.text ?? "");
    return { content: [{ type: "text", text }], structuredContent: { echoed: text } };
  });
  server.setRequestHandler(ReadResourceRequestSchema, (request) => ({
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/html;profile=mcp-app",
        text: "<html>app</html>",
        _meta: { ui: { prefersBorder: true } },
      },
    ],
  }));
  server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: [{ name: "greet" }] }));
  return server;
};

const closeHttpServer = (server: NodeHttp.Server) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );

/** A stateless Streamable HTTP server that wants an API key header. */
const fakeUpstream = Effect.acquireRelease(
  Effect.promise(async () => {
    const httpServer = NodeHttp.createServer((request, response) => {
      if (request.headers["x-api-key"] !== UPSTREAM_KEY) {
        response.writeHead(401).end();
        return;
      }
      const server = makeFakeUpstream();
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      response.on("close", () => void server.close());
      void server
        .connect(cast<typeof transport, Transport>(transport))
        .then(() => transport.handleRequest(request, response));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = cast<ReturnType<typeof httpServer.address>, NodeNet.AddressInfo>(
      httpServer.address(),
    );
    return { httpServer, url: `http://127.0.0.1:${port}/mcp` };
  }),
  ({ httpServer }) => closeHttpServer(httpServer),
);

/** Resolves the SDK from this package, since `-e` resolves imports from the working directory. */
const STDIO_SERVER_SCRIPT = `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const server = new Server({ name: "stdio-fake", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(CallToolRequestSchema, () => ({
  content: [{ type: "text", text: process.env.FAKE_TOKEN ?? "missing" }],
}));
await server.connect(new StdioServerTransport());
`;

const threadToken = "thread-token";
const clientToken = "client-token";
const baseScope = {
  environmentId: EnvironmentId.make("environment:mcp-upstream-test"),
  capabilities: new Set(["orchestration"] as const),
  issuedAt: 1,
  requestNamespace: "provider-session",
};
const threadScope: McpInvocationContext.McpInvocationScope = {
  ...baseScope,
  thread: {
    threadId: ThreadId.make("thread-upstream"),
    providerSessionId: "provider-session",
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  },
  client: undefined,
};
const clientScope: McpInvocationContext.McpInvocationScope = {
  ...baseScope,
  thread: undefined,
  client: { sessionId: "client-session", label: "Outside client", access: "full-access" },
};

const layerSessions = Layer.mock(McpSessionRegistry.McpSessionRegistry)({
  resolve: (presented) =>
    Effect.succeed(
      cast<McpInvocationContext.McpInvocationScope | undefined, never>(
        presented === threadToken
          ? threadScope
          : presented === clientToken
            ? clientScope
            : undefined,
      ),
    ),
});

const layerSecretRequests = Layer.mock(SecretRequests.SecretRequests)({
  consume: () => Effect.fail(new SecretRequestError({ reason: "ref_unavailable" })),
});

const layerHub = McpUpstreamClients.layer.pipe(
  Layer.provideMerge(McpServerRegistry.layer),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-upstream-test-" })),
);

interface JsonRpcResponse {
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
}

const setup = Effect.gen(function* () {
  const upstream = yield* fakeUpstream;
  const hub = yield* Layer.build(layerHub);
  yield* HttpRouter.serve(McpHttpServer.layerUpstreamRoute.pipe(Layer.provide(layerSessions)), {
    disableListenLog: true,
    disableLogger: true,
  }).pipe(Layer.provide(Layer.succeedContext(hub)), Layer.build);
  const registry = Context.get(hub, McpServerRegistry.McpServerRegistry);
  const httpClient = yield* HttpClient.HttpClient;

  const post = (input: {
    readonly serverId: McpServerId;
    readonly token?: string;
    readonly method: string;
    readonly params?: unknown;
  }) =>
    httpClient.post(`/mcp/upstream/${input.serverId}`, {
      headers: {
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(input.token === undefined ? {} : { authorization: `Bearer ${input.token}` }),
      },
      body: HttpBody.text(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: input.method, params: input.params ?? {} }),
        "application/json",
      ),
    });
  const call = (serverId: McpServerId, method: string, params?: unknown) =>
    post({ serverId, token: threadToken, method, params }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.map((body) => cast<unknown, JsonRpcResponse>(body)),
    );
  return { upstream, registry, post, call };
});

it.layer(Layer.merge(NodeServices.layer, layerSecretRequests))("MCP upstream route", (it) => {
  it.effect("forwards tools, resources, prompts and upstream errors unchanged", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { upstream, registry, call } = yield* setup;
        const { id } = yield* registry.upsert({
          name: "fake",
          transport: { type: "http", url: upstream.url },
          auth: { type: "header", header: "X-API-Key", secret: UPSTREAM_KEY },
        });

        const initialized = yield* call(id, "initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "provider", version: "1.0.0" },
        });
        assert.deepStrictEqual(initialized.result?.serverInfo, {
          name: "fake-upstream",
          version: "1.2.3",
        });
        assert.strictEqual(initialized.result?.instructions, "Use echo.");
        assert.hasAllKeys(initialized.result?.capabilities, ["tools", "resources", "prompts"]);

        const tools = yield* call(id, "tools/list");
        assert.deepStrictEqual(
          cast<unknown, ReadonlyArray<{ readonly _meta?: unknown }>>(tools.result?.tools)[0]?._meta,
          { ui: { resourceUri: UI_RESOURCE } },
        );

        const echoed = yield* call(id, "tools/call", {
          name: "echo",
          arguments: { text: "hello" },
        });
        assert.deepStrictEqual(echoed.result?.structuredContent, { echoed: "hello" });

        const unknown = yield* call(id, "tools/call", { name: "missing", arguments: {} });
        assert.strictEqual(unknown.error?.code, ErrorCode.InvalidParams);
        assert.include(unknown.error?.message, "Unknown tool: missing");

        const resource = yield* call(id, "resources/read", { uri: UI_RESOURCE });
        assert.deepStrictEqual(resource.result?.contents, [
          {
            uri: UI_RESOURCE,
            mimeType: "text/html;profile=mcp-app",
            text: "<html>app</html>",
            _meta: { ui: { prefersBorder: true } },
          },
        ]);

        const prompts = yield* call(id, "prompts/list");
        assert.deepStrictEqual(prompts.result?.prompts, [{ name: "greet" }]);

        const { servers } = yield* registry.list;
        assert.deepStrictEqual(servers[0]?.status, { state: "connected" });
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("rejects disabled servers, outside clients and missing credentials", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { upstream, registry, post } = yield* setup;
        const { id } = yield* registry.upsert({
          name: "fake",
          enabled: false,
          transport: { type: "http", url: upstream.url },
          auth: { type: "header", header: "X-API-Key", secret: UPSTREAM_KEY },
        });

        const disabled = yield* post({ serverId: id, token: threadToken, method: "tools/list" });
        assert.strictEqual(disabled.status, 404);
        assert.strictEqual(
          cast<unknown, { readonly error: string }>(yield* disabled.json).error,
          "mcp_server_disabled",
        );

        yield* registry.setEnabled({ id, enabled: true });
        const outside = yield* post({ serverId: id, token: clientToken, method: "tools/list" });
        assert.strictEqual(outside.status, 403);
        const anonymous = yield* post({ serverId: id, method: "tools/list" });
        assert.strictEqual(anonymous.status, 401);
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("reports a rejected credential without answering 401", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { upstream, registry, post } = yield* setup;
        const { id } = yield* registry.upsert({
          name: "fake",
          transport: { type: "http", url: upstream.url },
          auth: { type: "header", header: "X-API-Key", secret: "wrong-key" },
        });

        const response = yield* post({ serverId: id, token: threadToken, method: "tools/list" });
        assert.strictEqual(response.status, 503);
        assert.strictEqual(
          cast<unknown, { readonly error: string }>(yield* response.json).error,
          "mcp_server_rejected_credential",
        );
        const { servers } = yield* registry.list;
        assert.deepStrictEqual(servers[0]?.status, {
          state: "error",
          message: "That MCP server rejected the stored credential.",
        });
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.effect("runs a stdio server with its secret environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { registry, call } = yield* setup;
        const { id } = yield* registry.upsert({
          name: "local",
          transport: {
            type: "stdio",
            command: process.execPath,
            args: ["--input-type=module", "-e", STDIO_SERVER_SCRIPT],
            secretEnv: { FAKE_TOKEN: { secret: "stdio-secret" } },
          },
        });
        const result = yield* call(id, "tools/call", { name: "token", arguments: {} });
        assert.deepStrictEqual(result.result?.content, [{ type: "text", text: "stdio-secret" }]);
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
