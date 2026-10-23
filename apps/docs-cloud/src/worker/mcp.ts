import type { ApiDeps } from "./api.ts";
import * as Auth from "./auth.ts";
import { callTool, McpToolError, TOOLS } from "./mcpTools.ts";

/**
 * Agent MCP endpoint at `/mcp`: Streamable HTTP in its stateless JSON form.
 * Every request is one JSON-RPC message in a POST and gets a JSON reply; there
 * is no session and no server-initiated stream, so GET is refused. Tools read
 * through `docs.ts` and write through `deps.rooms`, so agent edits reach open
 * editors exactly like REST writes do.
 */

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const MCP_INSTRUCTIONS = `Docs Cloud holds living markdown docs that the user watches update live in their editor.
Workflow:
1. When asked for a doc, plan or write-up, create it first: create_doc with the title and a skeleton (the section headings, each with a one-line placeholder). Do this before research.
2. Give the user the doc URL from the response right away, then work.
3. Fill sections one at a time with edit_tab (replace a placeholder with the finished section), so the user watches the doc build. Use write_tab only for a new or fully rewritten tab.
4. Use tabs (create_tab) for distinct parts such as research, plan and decisions; nest with parentTabId.
5. Draw diagrams as \`\`\`mermaid code blocks.
6. Keep findings in the doc, not the chat. End with one line and the URL.
Re-read a tab (read_doc with tabId) before editing it if the user may have changed it.`;

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

const rpcResult = (id: JsonRpcRequest["id"], result: unknown) =>
  Response.json({ jsonrpc: "2.0", id, result }, { headers: { "Cache-Control": "no-store" } });

const rpcError = (id: JsonRpcRequest["id"] | null, code: number, message: string, status = 200) =>
  Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );

function isRequest(body: unknown): body is JsonRpcRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const message = body as Record<string, unknown>;
  return message.jsonrpc === "2.0" && typeof message.method === "string";
}

export async function handleMcp(request: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.replace(/\/+$/, "") !== "/mcp") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Only bearer tokens: a session cookie is ambient and SameSite=None, so a
  // cross-site text/plain POST could otherwise drive the tools.
  const principal = await Auth.authenticate(deps.db, request, deps.now());
  if (principal?.kind !== "token") {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="docs-cloud"' } },
    );
  }

  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (!isRequest(body)) return rpcError(null, -32600, "Invalid request", 400);
  // Notifications (no id) and client responses need no reply.
  if (body.id === undefined) return new Response(null, { status: 202 });

  const params = body.params ?? {};
  switch (body.method) {
    case "initialize": {
      const requested = params.protocolVersion;
      return rpcResult(body.id, {
        protocolVersion:
          typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "docs-cloud", title: "Docs Cloud", version: "0.1.0" },
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(body.id, {});
    case "tools/list":
      return rpcResult(body.id, { tools: TOOLS });
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string") return rpcError(body.id, -32602, "Missing tool name");
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const result = await callTool(name, args, { deps, origin: url.origin });
        return rpcResult(body.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (cause) {
        if (cause instanceof McpToolError) {
          if (cause.unknownTool) return rpcError(body.id, -32602, cause.message);
          return rpcResult(body.id, {
            content: [{ type: "text", text: JSON.stringify(cause.detail, null, 2) }],
            isError: true,
          });
        }
        throw cause;
      }
    }
    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}
