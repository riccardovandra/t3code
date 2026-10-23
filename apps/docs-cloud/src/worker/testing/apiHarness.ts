import type { RoomMessage } from "../../shared/protocol.ts";
import { handleApi, type ApiDeps } from "../api.ts";
import { parseOwnerEmails } from "../auth.ts";
import * as Docs from "../docs.ts";
import { makeTestD1 } from "./sqliteD1.ts";

export const ORIGIN = "https://docs.test";
export const OWNER = "owner@example.com";

/** Runs the real API against an in-memory D1, with DocRooms that apply writes inline and record broadcasts. */
export function makeApiHarness() {
  const db = makeTestD1();
  const clock = { now: 1_000_000 };
  const sentCodes: Array<{ email: string; code: string }> = [];
  const broadcasts: Array<RoomMessage> = [];
  const deps: ApiDeps = {
    db,
    owners: parseOwnerEmails(`${OWNER}, second@example.com`),
    rooms: {
      createTab: async (docId, { origin, ...input }) => {
        const tab = await Docs.createTab(db, { docId, ...input, now: clock.now });
        broadcasts.push({ type: "tab.created", tab, origin });
        return tab;
      },
      writeTab: async (_docId, { origin, ...input }) => {
        const result = await Docs.writeTab(db, { ...input, now: clock.now });
        if (result.ok) broadcasts.push({ type: "tab.updated", tab: result.tab, origin });
        return result;
      },
      moveTab: async (_docId, { origin, ...input }) => {
        const placements = await Docs.moveTab(db, { ...input, now: clock.now });
        if (placements.length > 0) broadcasts.push({ type: "tab.moved", placements, origin });
        return placements;
      },
      deleteTab: async (_docId, { origin, tabId }) => {
        const { deletedTabIds, placements } = await Docs.deleteTab(db, { tabId, now: clock.now });
        broadcasts.push({ type: "tab.deleted", tabIds: deletedTabIds, placements, origin });
        return deletedTabIds;
      },
      openSocket: async () => new Response(null, { status: 204 }),
    },
    sendLoginCode: async (email, code) => {
      sentCodes.push({ email, code });
    },
    waitUntil: () => undefined,
    now: () => clock.now,
  };

  const call = (
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    handleApi(
      new Request(ORIGIN + path, {
        method,
        headers: {
          Origin: ORIGIN,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
      deps,
    );

  const signIn = async (email = OWNER): Promise<string> => {
    await call("POST", "/api/auth/request-code", { body: { email } });
    const sent = sentCodes.findLast((entry) => entry.email === email);
    if (!sent) throw new Error("no code sent");
    const response = await call("POST", "/api/auth/verify", { body: { email, code: sent.code } });
    const cookie = response.headers.get("Set-Cookie");
    if (!cookie) throw new Error("no session cookie");
    return cookie.split(";")[0]!;
  };

  return { db, clock, deps, sentCodes, broadcasts, call, signIn };
}
