import { assert, describe, it } from "@effect/vitest";
import type { McpServerEntry, McpServerId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";

import * as McpServerRegistry from "../mcpHub/McpServerRegistry.ts";
import * as McpUpstreamClients from "../mcpHub/McpUpstreamClients.ts";
import * as DocsCloudSendTo from "./DocsCloudSendTo.ts";

const docsCloudServer = {
  id: "server-docs-cloud",
  name: "docs-cloud",
  enabled: true,
  transport: { type: "http", url: "https://docs.example.test/mcp" },
  auth: { type: "header", header: "Authorization" },
} as unknown as McpServerEntry;

const notionServer = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "server-notion",
    name: "Work wiki",
    enabled: true,
    transport: { type: "http", url: "https://mcp.notion.com/mcp" },
    auth: { type: "oauth" },
    ...overrides,
  }) as unknown as McpServerEntry;

/** Answers the two Docs Cloud routes the service reads, recording what it asked for. */
const makeDocsCloud = () => {
  const requests: Array<string> = [];
  const client = HttpClient.make((request: HttpClientRequest.HttpClientRequest) => {
    const { pathname } = new URL(request.url);
    requests.push(`${request.headers["authorization"]} ${pathname}`);
    const respond = (status: number, body: string, type = "application/json") =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(body, { status, headers: { "content-type": type } }),
        ),
      );
    if (pathname === "/api/docs/doc-1") {
      return respond(200, JSON.stringify({ doc: { id: "doc-1", title: "Launch Plan" }, tabs: [] }));
    }
    if (pathname === "/api/docs/doc-1/export.md") {
      return respond(200, "# Launch Plan\n\nIntro\n\n## Risks\n\n- none\n", "text/markdown");
    }
    return respond(404, JSON.stringify({ error: "not_found" }));
  });
  return { requests, client };
};

/** A Notion MCP session that records calls and answers with `reply`. */
const makeHub = (
  options: {
    tools?: Array<string>;
    reply?: unknown;
    openError?: McpUpstreamClients.McpUpstreamError["reason"];
  } = {},
) => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const opened: Array<McpServerId> = [];
  const service = McpUpstreamClients.McpUpstreamClients.of({
    open: (id) =>
      options.openError
        ? Effect.fail(
            new McpUpstreamClients.McpUpstreamError({ serverId: id, reason: options.openError }),
          )
        : Effect.sync(() => {
            opened.push(id);
            return {
              capabilities: { tools: {} },
              serverInfo: undefined,
              instructions: undefined,
              request: (method, params) =>
                Effect.sync(() => {
                  calls.push({ method, params });
                  if (method === "tools/list") {
                    return {
                      tools: (options.tools ?? ["notion-search", "notion-create-pages"]).map(
                        (name) => ({ name, inputSchema: { type: "object" } }),
                      ),
                    };
                  }
                  return (
                    (options.reply as Record<string, unknown> | undefined) ?? {
                      content: [
                        {
                          type: "text",
                          text: '{"pages":[{"id":"p1","url":"https://www.notion.so/Launch-Plan-p1"}]}',
                        },
                      ],
                    }
                  );
                }),
            };
          }),
  });
  return { calls, opened, layer: Layer.succeed(McpUpstreamClients.McpUpstreamClients, service) };
};

const makeLayer = (input: {
  servers: Array<McpServerEntry>;
  hub: ReturnType<typeof makeHub>;
  docsCloud: ReturnType<typeof makeDocsCloud>;
}) =>
  DocsCloudSendTo.layer.pipe(
    Layer.provide(input.hub.layer),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, input.docsCloud.client)),
    Layer.provide(
      Layer.mock(McpServerRegistry.McpServerRegistry)({
        list: Effect.succeed({ servers: input.servers }),
        credentials: () =>
          Effect.succeed({ headers: { Authorization: "Bearer dct_good" }, env: {} }),
      }),
    ),
  );

const send = Effect.flatMap(DocsCloudSendTo.DocsCloudSendTo, (service) =>
  service.sendTo({ docId: "doc-1", target: "notion" }),
);

describe("DocsCloudSendTo", () => {
  it.effect("creates a Notion page from the doc's Markdown and returns its URL", () => {
    const hub = makeHub();
    const docsCloud = makeDocsCloud();
    return Effect.gen(function* () {
      const result = yield* send;
      assert.deepStrictEqual(result, {
        title: "Launch Plan",
        url: "https://www.notion.so/Launch-Plan-p1",
      });
      assert.deepStrictEqual(docsCloud.requests, [
        "Bearer dct_good /api/docs/doc-1",
        "Bearer dct_good /api/docs/doc-1/export.md",
      ]);
      assert.deepStrictEqual(hub.opened, ["server-notion"]);
      assert.deepStrictEqual(hub.calls[1], {
        method: "tools/call",
        params: {
          name: "notion-create-pages",
          arguments: {
            pages: [
              {
                properties: { title: "Launch Plan" },
                content: "Intro\n\n## Risks\n\n- none\n",
              },
            ],
          },
        },
      });
    }).pipe(
      Effect.provide(makeLayer({ servers: [docsCloudServer, notionServer()], hub, docsCloud })),
    );
  });

  it.effect("asks the user to connect Notion when no enabled Notion server exists", () => {
    const hub = makeHub();
    const docsCloud = makeDocsCloud();
    return Effect.gen(function* () {
      const error = yield* Effect.flip(send);
      assert.strictEqual(error._tag, "DocsCloudSendToError");
      assert.strictEqual(error.message, "Connect Notion in Settings → MCP Servers.");
      assert.deepStrictEqual(docsCloud.requests, []);
    }).pipe(
      Effect.provide(
        makeLayer({
          servers: [docsCloudServer, notionServer({ enabled: false })],
          hub,
          docsCloud,
        }),
      ),
    );
  });

  it.effect("reports sign-in, a server without the page tool, and tool errors", () =>
    Effect.gen(function* () {
      const cases = [
        { hub: makeHub({ openError: "needs_sign_in" }), reason: "needs_sign_in" },
        { hub: makeHub({ tools: ["notion-search"] }), reason: "unsupported" },
        {
          hub: makeHub({ reply: { isError: true, content: [{ type: "text", text: "quota" }] } }),
          reason: "failed",
        },
      ] as const;
      for (const { hub, reason } of cases) {
        const error = yield* Effect.flip(send).pipe(
          Effect.provide(
            makeLayer({
              servers: [docsCloudServer, notionServer()],
              hub,
              docsCloud: makeDocsCloud(),
            }),
          ),
        );
        assert.strictEqual(error._tag === "DocsCloudSendToError" && error.reason, reason);
      }
    }),
  );

  it.effect("fails as Docs Cloud not set up when its hub entry is missing", () => {
    const hub = makeHub();
    return Effect.gen(function* () {
      const error = yield* Effect.flip(send);
      assert.strictEqual(error._tag === "DocsCloudError" && error.reason, "not_configured");
      assert.deepStrictEqual(hub.opened, []);
    }).pipe(
      Effect.provide(makeLayer({ servers: [notionServer()], hub, docsCloud: makeDocsCloud() })),
    );
  });

  it("recognises Notion servers by name or address", () => {
    assert.isTrue(DocsCloudSendTo.isNotionServer(notionServer()));
    assert.isTrue(
      DocsCloudSendTo.isNotionServer(
        notionServer({ name: "notion", transport: { type: "stdio", command: "npx", args: [] } }),
      ),
    );
    assert.isFalse(DocsCloudSendTo.isNotionServer(docsCloudServer));
  });

  it("drops a leading heading that repeats the page title", () => {
    assert.strictEqual(DocsCloudSendTo.pageContent("# Plan\n\nBody", "plan"), "Body");
    assert.strictEqual(DocsCloudSendTo.pageContent("# Other\n\nBody", "Plan"), "# Other\n\nBody");
  });
});
