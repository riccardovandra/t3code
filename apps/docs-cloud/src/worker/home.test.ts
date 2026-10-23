import { describe, expect, it } from "vite-plus/test";

import { SEARCH_LIMIT, type HomeLibrary, type SearchHit } from "../shared/home.ts";
import type { DocWithTabs } from "../shared/protocol.ts";
import { makeApiHarness } from "./testing/apiHarness.ts";

async function body<A>(response: Response): Promise<A> {
  return (await response.json()) as A;
}

async function setup() {
  const api = makeApiHarness();
  const owner = await api.signIn();
  const as = (cookie: string) => ({ Cookie: cookie });
  const createDoc = async (title: string, markdown: string, cookie = owner) => {
    const created = await body<DocWithTabs>(
      await api.call("POST", "/api/docs", {
        body: { projectId: null, title },
        headers: as(cookie),
      }),
    );
    const tab = created.tabs[0]!;
    await api.call("PATCH", `/api/tabs/${tab.id}`, {
      body: { baseVersion: tab.version, markdown },
      headers: as(cookie),
    });
    return created.doc.id;
  };
  const libraryDocs = async (cookie: string) =>
    (await body<HomeLibrary>(await api.call("GET", "/api/library", { headers: as(cookie) })))
      .noProjectDocs;
  const search = async (cookie: string, q: string) =>
    api.call("GET", `/api/search?q=${encodeURIComponent(q)}`, { headers: as(cookie) });
  return { api, owner, as, createDoc, libraryDocs, search };
}

describe("home library", () => {
  it("carries a short text preview, member count and the caller's last open", async () => {
    const { api, owner, as, createDoc, libraryDocs } = await setup();
    const long = "word ".repeat(2000);
    const docId = await createDoc("Plan", `# Plan\n\nThe **goal** is clear.\n\n${long}`);

    const [doc] = await libraryDocs(owner);
    expect(doc).toMatchObject({ id: docId, memberCount: 1, openedAt: null });
    expect(doc!.preview.startsWith("The goal is clear.\nword word")).toBe(true);
    expect(doc!.preview.length).toBeLessThanOrEqual(601);
    expect(JSON.stringify(doc)).not.toContain("**goal**");

    await api.call("POST", `/api/docs/${docId}/members`, {
      body: { email: "guest@example.com", role: "viewer" },
      headers: as(owner),
    });
    api.clock.now = 2_000_000;
    await api.call("GET", `/api/docs/${docId}`, { headers: as(owner) });
    expect((await libraryDocs(owner))[0]).toMatchObject({ memberCount: 2, openedAt: 2_000_000 });
  });

  it("tracks opens per person, and a newer open replaces the old one", async () => {
    const { api, owner, as, createDoc, libraryDocs } = await setup();
    const docId = await createDoc("Plan", "Body");
    await api.call("POST", `/api/docs/${docId}/members`, {
      body: { email: "guest@example.com", role: "viewer" },
      headers: as(owner),
    });
    const guest = await api.signIn("guest@example.com");

    api.clock.now = 2_000_000;
    await api.call("GET", `/api/docs/${docId}`, { headers: as(guest) });
    api.clock.now = 3_000_000;
    await api.call("GET", `/api/docs/${docId}`, { headers: as(guest) });

    expect((await libraryDocs(guest))[0]?.openedAt).toBe(3_000_000);
    expect((await libraryDocs(owner))[0]?.openedAt).toBeNull();
  });

  it("does not count an agent token reading the doc as an open", async () => {
    const { api, owner, as, createDoc, libraryDocs } = await setup();
    const docId = await createDoc("Plan", "Body");
    const { token } = await body<{ token: string }>(
      await api.call("POST", "/api/tokens", { body: { name: "agent" }, headers: as(owner) }),
    );
    const read = await api.call("GET", `/api/docs/${docId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(read.status).toBe(200);
    expect((await libraryDocs(owner))[0]?.openedAt).toBeNull();
  });

  it("does not record an open for someone who cannot see the doc", async () => {
    const { api, owner, as, createDoc } = await setup();
    const visible = await createDoc("Shared", "Body");
    const hidden = await createDoc("Private", "Body");
    await api.call("POST", `/api/docs/${visible}/members`, {
      body: { email: "guest@example.com", role: "viewer" },
      headers: as(owner),
    });
    const guest = await api.signIn("guest@example.com");
    const read = await api.call("GET", `/api/docs/${hidden}`, { headers: as(guest) });
    expect(read.status).toBe(404);
    const opens = await api.db
      .prepare("SELECT count(*) AS n FROM doc_opens")
      .first<{ n: number }>();
    expect(opens?.n).toBe(0);
  });
});

describe("GET /api/search", () => {
  it("finds tab Markdown only in docs the caller is on, with a snippet", async () => {
    const { api, owner, as, createDoc, search } = await setup();
    const shared = await createDoc("Shared", "Intro.\n\nThe **budget** for Q3 is fixed.");
    await createDoc("Private", "Our budget is secret.");
    await api.call("POST", `/api/docs/${shared}/members`, {
      body: { email: "guest@example.com", role: "viewer" },
      headers: as(owner),
    });
    const guest = await api.signIn("guest@example.com");

    const guestHits = await body<{ hits: Array<SearchHit> }>(await search(guest, "BUDGET"));
    expect(guestHits.hits.map((hit) => hit.docId)).toEqual([shared]);
    expect(guestHits.hits[0]!.snippet).toBe("Intro. The budget for Q3 is fixed.");

    const ownerHits = await body<{ hits: Array<SearchHit> }>(await search(owner, "budget"));
    expect(ownerHits.hits).toHaveLength(2);
  });

  it("treats LIKE wildcards literally", async () => {
    const { owner, createDoc, search } = await setup();
    await createDoc("Rates", "Growth of 50% this year.");
    await createDoc("Other", "Nothing here at 50 percent.");
    const hits = await body<{ hits: Array<SearchHit> }>(await search(owner, "50%"));
    expect(hits.hits).toHaveLength(1);
    expect((await body<{ hits: Array<SearchHit> }>(await search(owner, "__"))).hits).toEqual([]);
  });

  it("caps results and rejects queries that are too short or too long", async () => {
    const { owner, createDoc, search } = await setup();
    for (let index = 0; index < SEARCH_LIMIT + 3; index += 1) {
      await createDoc(`Doc ${index}`, "needle in a haystack");
    }
    const hits = await body<{ hits: Array<SearchHit> }>(await search(owner, "needle"));
    expect(hits.hits).toHaveLength(SEARCH_LIMIT);
    expect((await search(owner, "n")).status).toBe(400);
    expect((await search(owner, "n".repeat(101))).status).toBe(400);
  });
});
