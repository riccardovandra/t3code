import { handleApi, type ApiDeps } from "./api.ts";
import { parseOwnerEmails } from "./auth.ts";
import { docRoom } from "./docRoom.ts";
import type { Env } from "./env.ts";
import { handleMcp } from "./mcp.ts";
import { sendLoginCode } from "./email.ts";

export { DocRoom } from "./docRoom.ts";

function apiDeps(env: Env, ctx: ExecutionContext): ApiDeps {
  return {
    db: env.DB,
    owners: parseOwnerEmails(env.OWNER_EMAILS),
    rooms: {
      createTab: (docId, input) => docRoom(env, docId).createTab({ docId, ...input }),
      writeTab: (docId, input) => docRoom(env, docId).writeTab(input),
      openSocket: (docId, request) => docRoom(env, docId).fetch(request),
    },
    sendLoginCode: (email, code) => sendLoginCode(env, email, code),
    waitUntil: (promise) => ctx.waitUntil(promise),
    now: () => Date.now(),
  };
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return handleApi(request, apiDeps(env, ctx));
    }
    if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      return handleMcp(request, apiDeps(env, ctx));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
