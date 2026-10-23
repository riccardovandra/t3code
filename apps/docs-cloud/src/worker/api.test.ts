import { describe, expect, it } from "vite-plus/test";

import type { DocWithTabs, Tab } from "../shared/protocol.ts";
import { makeApiHarness } from "./testing/apiHarness.ts";

async function seedDoc(api: ReturnType<typeof makeApiHarness>, cookie: string) {
  const projectResponse = await api.call("POST", "/api/projects", {
    body: { name: "Uplifted" },
    headers: { Cookie: cookie },
  });
  const { project } = (await projectResponse.json()) as { project: { id: string } };
  const docResponse = await api.call("POST", "/api/docs", {
    body: { projectId: project.id, title: "Plan" },
    headers: { Cookie: cookie },
  });
  return (await docResponse.json()) as DocWithTabs;
}

describe("API permissions", () => {
  it("rejects requests without a session or token", async () => {
    const api = makeApiHarness();
    expect((await api.call("GET", "/api/library")).status).toBe(401);
    const forged = await api.call("GET", "/api/library", {
      headers: { Authorization: "Bearer dct_forged" },
    });
    expect(forged.status).toBe(401);
  });

  it("accepts a bearer token until it is revoked", async () => {
    const api = makeApiHarness();
    const cookie = await api.signIn();
    const created = await api.call("POST", "/api/tokens", {
      body: { name: "agent" },
      headers: { Cookie: cookie },
    });
    const { id, token } = (await created.json()) as { id: string; token: string };
    const bearer = { Authorization: `Bearer ${token}` };

    expect((await api.call("GET", "/api/library", { headers: bearer })).status).toBe(200);
    // A token is not an ambient credential, so it works from any origin.
    const project = await api.call("POST", "/api/projects", {
      body: { name: "From agent" },
      headers: { ...bearer, Origin: "https://elsewhere.test" },
    });
    expect(project.status).toBe(201);

    const listed = await api.call("GET", "/api/tokens", { headers: { Cookie: cookie } });
    expect(JSON.stringify(await listed.json())).not.toContain(token);

    await api.call("DELETE", `/api/tokens/${id}`, { headers: { Cookie: cookie } });
    expect((await api.call("GET", "/api/library", { headers: bearer })).status).toBe(401);
  });

  it("keeps token management behind a session", async () => {
    const api = makeApiHarness();
    const cookie = await api.signIn();
    const created = await api.call("POST", "/api/tokens", {
      body: { name: "agent" },
      headers: { Cookie: cookie },
    });
    const { token } = (await created.json()) as { token: string };
    const minted = await api.call("POST", "/api/tokens", {
      body: { name: "escalate" },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(minted.status).toBe(403);
  });

  it("refuses cookie-authed writes from another origin or as a form post", async () => {
    const api = makeApiHarness();
    const cookie = await api.signIn();
    const crossSite = await api.call("POST", "/api/projects", {
      body: { name: "x" },
      headers: { Cookie: cookie, Origin: "https://evil.test" },
    });
    expect(crossSite.status).toBe(403);
    const form = await api.call("POST", "/api/projects", {
      body: { name: "x" },
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(form.status).toBe(403);
    const socket = await api.call("GET", "/api/docs/any/ws", {
      headers: { Cookie: cookie, Origin: "https://evil.test", Upgrade: "websocket" },
    });
    expect(socket.status).toBe(403);
  });
});

describe("tab writes", () => {
  it("bumps the version, broadcasts, and returns 409 with the current tab on a stale base", async () => {
    const api = makeApiHarness();
    const cookie = await api.signIn();
    const { tabs } = await seedDoc(api, cookie);
    const tab = tabs[0]!;
    expect(tab.version).toBe(1);

    const first = await api.call("PATCH", `/api/tabs/${tab.id}`, {
      body: { baseVersion: 1, markdown: "# Hello", clientId: "editor-a" },
      headers: { Cookie: cookie },
    });
    expect(first.status).toBe(200);
    const saved = ((await first.json()) as { tab: Tab }).tab;
    expect(saved).toMatchObject({ version: 2, markdown: "# Hello" });
    expect(api.broadcasts.at(-1)).toEqual({ type: "tab.updated", tab: saved, origin: "editor-a" });

    const stale = await api.call("PATCH", `/api/tabs/${tab.id}`, {
      body: { baseVersion: 1, markdown: "# Overwrite" },
      headers: { Cookie: cookie },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: "version_conflict",
      tab: { version: 2, markdown: "# Hello" },
    });
    expect(api.broadcasts).toHaveLength(1);
  });

  it("supports nested tabs ordered among their siblings", async () => {
    const api = makeApiHarness();
    const cookie = await api.signIn();
    const { doc, tabs } = await seedDoc(api, cookie);
    const create = async (title: string, parentTabId?: string) => {
      const response = await api.call("POST", `/api/docs/${doc.id}/tabs`, {
        body: { title, ...(parentTabId ? { parentTabId } : {}) },
        headers: { Cookie: cookie },
      });
      return ((await response.json()) as { tab: Tab }).tab;
    };
    const second = await create("Second");
    const child = await create("Child", tabs[0]!.id);
    const sibling = await create("Child 2", tabs[0]!.id);
    expect(second).toMatchObject({ parentTabId: null, position: 1 });
    expect(child).toMatchObject({ parentTabId: tabs[0]!.id, position: 0 });
    expect(sibling.position).toBe(1);

    const loaded = await api.call("GET", `/api/docs/${doc.id}`, { headers: { Cookie: cookie } });
    expect(((await loaded.json()) as DocWithTabs).tabs).toHaveLength(4);
  });

  it("rejects a parent tab from another doc", async () => {
    const api = makeApiHarness();
    const cookie = await api.signIn();
    const first = await seedDoc(api, cookie);
    const second = await seedDoc(api, cookie);
    const response = await api.call("POST", `/api/docs/${second.doc.id}/tabs`, {
      body: { title: "Bad", parentTabId: first.tabs[0]!.id },
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(404);
  });
});
