import type { ApiDeps } from "./api.ts";

/**
 * Mount point for the agent MCP endpoint at `/mcp`. It authenticates with the
 * same bearer tokens as `/api/*` and should call the service functions in
 * `docs.ts` for reads and `deps.rooms` for writes, so agent edits reach open
 * editors exactly like REST writes do.
 */
export async function handleMcp(_request: Request, _deps: ApiDeps): Promise<Response> {
  return Response.json({ error: "not_implemented" }, { status: 501 });
}
