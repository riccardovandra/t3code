/**
 * DocsCloudSendTo - copies a Docs Cloud doc into another app as a new page,
 * through that app's MCP server in this environment's hub. The server reads
 * the doc with the hub's Docs Cloud token, so the frame never handles either
 * credential.
 *
 * @module DocsCloudSendTo
 */
import {
  DocsCloudError,
  DocsCloudSendToError,
  type DocsCloudSendToInput,
  type DocsCloudSendToResult,
  type McpServerEntry,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as McpServerRegistry from "../mcpHub/McpServerRegistry.ts";
import * as McpUpstreamClients from "../mcpHub/McpUpstreamClients.ts";
import { type Connection, docsCloudConnection } from "./DocsCloudImport.ts";

/** A hub entry is Notion's when its name or address says so, as users name them freely. */
export const isNotionServer = (server: McpServerEntry): boolean =>
  /notion/i.test(server.name) ||
  (server.transport.type === "http" &&
    /(^|\.)notion\.(com|so)$/i.test(hostOf(server.transport.url)));

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Notion's hosted server names it `notion-create-pages`; self-hosted forks drop the prefix. */
const CREATE_PAGES_TOOL = /(^|[-_])create[-_]pages$/;
const NOTION_URL = /https:\/\/(?:www\.)?notion\.(?:so|site)\/[^\s"'<>)\]\\]+/;

const DocSummary = Schema.Struct({ doc: Schema.Struct({ title: Schema.String }) });
const ToolList = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ name: Schema.String })),
});
const ToolResult = Schema.Struct({
  isError: Schema.optional(Schema.Boolean),
  content: Schema.optional(
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
  ),
});

const decodeDocSummary = Schema.decodeUnknownEffect(DocSummary);
const decodeToolList = Schema.decodeUnknownEffect(ToolList);
const decodeToolResult = Schema.decodeUnknownEffect(ToolResult);

/** The page carries the title itself, so a leading `# Title` would repeat it. */
export const pageContent = (markdown: string, title: string): string => {
  const match = /^#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(markdown);
  return match && match[1]!.trim().toLowerCase() === title.trim().toLowerCase()
    ? markdown.slice(match[0].length).replace(/^\n+/, "")
    : markdown;
};

export class DocsCloudSendTo extends Context.Service<
  DocsCloudSendTo,
  {
    readonly sendTo: (
      input: DocsCloudSendToInput,
    ) => Effect.Effect<DocsCloudSendToResult, DocsCloudError | DocsCloudSendToError>;
  }
>()("t3/docs/DocsCloudSendTo") {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const registry = yield* McpServerRegistry.McpServerRegistry;
  const clients = yield* McpUpstreamClients.McpUpstreamClients;

  const fetchDoc = Effect.fn("DocsCloudSendTo.fetchDoc")(function* (
    conn: Connection,
    docId: string,
  ) {
    const get = (path: string) =>
      http
        .execute(
          HttpClientRequest.get(`${conn.origin}${path}`).pipe(
            HttpClientRequest.setHeader("Authorization", conn.authorization),
          ),
        )
        .pipe(
          Effect.timeout("20 seconds"),
          Effect.mapError(
            (cause) => new DocsCloudError({ reason: "unreachable", detail: String(cause) }),
          ),
          Effect.flatMap((response) =>
            response.status === 401 || response.status === 403
              ? Effect.fail(new DocsCloudError({ reason: "unauthorized" }))
              : response.status < 200 || response.status >= 300
                ? Effect.fail(
                    new DocsCloudError({ reason: "failed", detail: `HTTP ${response.status}` }),
                  )
                : Effect.succeed(response),
          ),
        );
    const id = encodeURIComponent(docId);
    const summary = yield* get(`/api/docs/${id}`).pipe(
      Effect.flatMap((response) =>
        response.json.pipe(
          Effect.flatMap(decodeDocSummary),
          Effect.mapError(
            () => new DocsCloudError({ reason: "failed", detail: "unexpected response" }),
          ),
        ),
      ),
    );
    const markdown = yield* get(`/api/docs/${id}/export.md`).pipe(
      Effect.flatMap((response) =>
        response.text.pipe(
          Effect.mapError(
            () => new DocsCloudError({ reason: "failed", detail: "unreadable export" }),
          ),
        ),
      ),
    );
    return { title: summary.doc.title, markdown };
  });

  const upstreamError = (error: McpUpstreamClients.McpUpstreamError) => {
    switch (error.reason) {
      case "needs_sign_in":
      case "rejected_credential":
        return new DocsCloudSendToError({ reason: "needs_sign_in" });
      case "not_found":
      case "disabled":
        return new DocsCloudSendToError({ reason: "not_connected" });
      default:
        return new DocsCloudSendToError({ reason: "failed", detail: error.message });
    }
  };

  const sendTo: DocsCloudSendTo["Service"]["sendTo"] = Effect.fn("DocsCloudSendTo.sendTo")(
    function* (input) {
      const { servers } = yield* registry.list.pipe(
        Effect.mapError(
          (cause) => new DocsCloudSendToError({ reason: "failed", detail: cause.message }),
        ),
      );
      const server = servers.find((entry) => entry.enabled && isNotionServer(entry));
      if (!server) return yield* new DocsCloudSendToError({ reason: "not_connected" });

      const doc = yield* fetchDoc(yield* docsCloudConnection(registry), input.docId);
      const session = yield* clients.open(server.id).pipe(Effect.mapError(upstreamError));
      const tools = yield* session.request("tools/list", {}).pipe(
        Effect.mapError(upstreamError),
        Effect.flatMap((listed) =>
          decodeToolList(listed).pipe(
            Effect.mapError(
              () => new DocsCloudSendToError({ reason: "failed", detail: "unexpected tool list" }),
            ),
          ),
        ),
      );
      const tool = tools.tools.find((candidate) => CREATE_PAGES_TOOL.test(candidate.name));
      if (!tool) return yield* new DocsCloudSendToError({ reason: "unsupported" });

      const result = yield* session
        .request("tools/call", {
          name: tool.name,
          // No parent: Notion files the page among the user's private pages.
          arguments: {
            pages: [
              { properties: { title: doc.title }, content: pageContent(doc.markdown, doc.title) },
            ],
          },
        })
        .pipe(
          Effect.mapError(upstreamError),
          Effect.flatMap((reply) =>
            decodeToolResult(reply).pipe(
              Effect.mapError(
                () =>
                  new DocsCloudSendToError({ reason: "failed", detail: "unexpected tool result" }),
              ),
            ),
          ),
        );
      const text = (result.content ?? []).map((part) => part.text ?? "").join("\n");
      if (result.isError) {
        const detail = text.trim().slice(0, 300);
        return yield* new DocsCloudSendToError({ reason: "failed", ...(detail ? { detail } : {}) });
      }
      return { title: doc.title, url: NOTION_URL.exec(text)?.[0] ?? null };
    },
  );

  return DocsCloudSendTo.of({ sendTo });
});

export const layer = Layer.effect(DocsCloudSendTo, make);
