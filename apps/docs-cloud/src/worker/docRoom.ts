import { DurableObject } from "cloudflare:workers";

import type { RoomMessage, Tab } from "../shared/protocol.ts";
import * as Docs from "./docs.ts";
import type { Env } from "./env.ts";

/**
 * One instance per doc, addressed by doc id. Every write to the doc runs here,
 * one at a time, then is pushed to the doc's open editors over hibernating
 * WebSockets. There is no merge layer: a stale `baseVersion` is a conflict.
 */
export class DocRoom extends DurableObject<Env> {
  // D1 calls are not covered by Durable Object input gates, so writes are
  // chained explicitly to keep them in arrival order.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keepalive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private serialize<A>(task: () => Promise<A>): Promise<A> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private broadcast(message: RoomMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // A socket closing mid-broadcast is cleaned up by the runtime.
      }
    }
  }

  async createTab(input: {
    readonly docId: string;
    readonly parentTabId: string | null;
    readonly title: string;
    readonly markdown: string;
    readonly origin: string | null;
  }): Promise<Tab> {
    return this.serialize(async () => {
      const tab = await Docs.createTab(this.env.DB, { ...input, now: Date.now() });
      this.broadcast({ type: "tab.created", tab, origin: input.origin });
      return tab;
    });
  }

  async writeTab(input: {
    readonly tabId: string;
    readonly baseVersion: number;
    readonly markdown?: string;
    readonly title?: string;
    readonly origin: string | null;
  }): Promise<Docs.TabWriteResult> {
    return this.serialize(async () => {
      const { origin, ...write } = input;
      const result = await Docs.writeTab(this.env.DB, { ...write, now: Date.now() });
      if (result.ok) this.broadcast({ type: "tab.updated", tab: result.tab, origin });
      return result;
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(): Promise<void> {
    // Clients only listen; writes arrive through the REST API.
  }

  override async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    socket.close(code === 1005 ? 1000 : code, "closing");
  }
}

export function docRoom(env: Env, docId: string): DurableObjectStub<DocRoom> {
  return env.DOC_ROOM.get(env.DOC_ROOM.idFromName(docId));
}
