import { describe, expect, it } from "vite-plus/test";

import * as Docs from "./docs.ts";
import { handleMcp } from "./mcp.ts";
import { makeApiHarness, ORIGIN } from "./testing/apiHarness.ts";

/** `requestOrigin` stands in for what request.url reports, which `wrangler dev` rewrites. */
async function makeMcpHarness(requestOrigin = ORIGIN) {
  const api = makeApiHarness();
  const cookie = await api.signIn();
  const created = await api.call("POST", "/api/tokens", {
    body: { name: "agent" },
    headers: { Cookie: cookie },
  });
  const { token } = (await created.json()) as { token: string };
  let nextId = 1;
  // Echoed like a real client, once initialize hands one out.
  let sessionId: string | null = null;

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handleMcp(
      new Request(`${requestOrigin}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      api.deps,
    );

  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await post(
      { jsonrpc: "2.0", id: nextId++, method, params },
      { Authorization: `Bearer ${token}`, ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) },
    );
    sessionId = response.headers.get("Mcp-Session-Id") ?? sessionId;
    return (await response.json()) as {
      result?: Record<string, unknown> & {
        content?: Array<{ text: string }>;
        isError?: boolean;
      };
      error?: { code: number; message: string };
    };
  };

  const tool = async (name: string, args: Record<string, unknown>) => {
    const { result } = await rpc("tools/call", { name, arguments: args });
    return {
      isError: result?.isError === true,
      body: JSON.parse(result!.content![0]!.text) as any,
    };
  };

  const seedDoc = async (markdown?: string) => {
    const project = await tool("create_project", { name: "Uplifted" });
    const doc = await tool("create_doc", {
      projectId: project.body.projectId,
      title: "Plan",
      ...(markdown === undefined ? {} : { markdown }),
    });
    return doc.body as { doc: { docId: string; url: string }; tab: { tabId: string } };
  };

  return { api, cookie, token, post, rpc, tool, seedDoc };
}

describe("MCP transport", () => {
  it("requires a bearer token, not a session cookie", async () => {
    const mcp = await makeMcpHarness();
    const message = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await mcp.post(message)).status).toBe(401);
    expect((await mcp.post(message, { Cookie: mcp.cookie })).status).toBe(401);
    expect((await mcp.post(message, { Authorization: "Bearer dct_forged" })).status).toBe(401);
    expect((await mcp.post(message, { Authorization: `Bearer ${mcp.token}` })).status).toBe(200);
  });

  it("negotiates the protocol, sends instructions and lists tools", async () => {
    const mcp = await makeMcpHarness();
    const init = await mcp.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.result?.protocolVersion).toBe("2025-06-18");
    expect(init.result?.instructions).toContain("edit_tab");
    const notified = await mcp.post(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { Authorization: `Bearer ${mcp.token}` },
    );
    expect(notified.status).toBe(202);
    const list = await mcp.rpc("tools/list");
    const names = (list.result!.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toContain("edit_tab");
    expect((await mcp.rpc("nope")).error?.code).toBe(-32601);
  });
});

describe("MCP tools", () => {
  it("creates a doc with a skeleton, returns its URL and pushes edits to editors", async () => {
    const mcp = await makeMcpHarness();
    const { doc, tab } = await mcp.seedDoc("# Plan\n\n## Goals\n\nTBD\n");
    expect(doc.url).toBe(`${ORIGIN}/d/${doc.docId}/${tab.tabId}`);

    const edit = await mcp.tool("edit_tab", {
      tabId: tab.tabId,
      find: "## Goals\n\nTBD",
      replace: "## Goals\n\nShip $& the MCP endpoint.",
    });
    expect(edit.isError).toBe(false);
    expect(edit.body.tab.url).toBe(`${ORIGIN}/d/${doc.docId}/${tab.tabId}`);
    expect(mcp.api.broadcasts.at(-1)).toMatchObject({ type: "tab.updated" });
    // The replacement is literal, not a String.replace pattern.
    expect(await Docs.getTabMarkdown(mcp.api.db, tab.tabId)).toBe(
      "# Plan\n\n## Goals\n\nShip $& the MCP endpoint.\n",
    );
  });

  it("refuses an edit_tab whose find text is missing or not unique", async () => {
    const mcp = await makeMcpHarness();
    const { tab } = await mcp.seedDoc("## A\n\nTBD\n\n## B\n\nTBD\n");
    const missing = await mcp.tool("edit_tab", { tabId: tab.tabId, find: "## C", replace: "x" });
    expect(missing).toMatchObject({ isError: true, body: { error: "no_match" } });
    const ambiguous = await mcp.tool("edit_tab", { tabId: tab.tabId, find: "TBD", replace: "x" });
    expect(ambiguous).toMatchObject({ isError: true, body: { error: "ambiguous_match" } });
    expect(ambiguous.body.message).toContain("2 times");
    expect(await Docs.getTabMarkdown(mcp.api.db, tab.tabId)).toBe("## A\n\nTBD\n\n## B\n\nTBD\n");
  });

  it("re-applies edit_tab on top of a concurrent write", async () => {
    const mcp = await makeMcpHarness();
    const { tab } = await mcp.seedDoc("## A\n\nTBD\n\n## B\n\nlater\n");
    const writeTab = mcp.api.deps.rooms.writeTab;
    let raced = false;
    // The user saves between the agent's read and its write.
    mcp.api.deps.rooms.writeTab = async (docId, input) => {
      if (!raced) {
        raced = true;
        const current = await Docs.getTab(mcp.api.db, input.tabId);
        await writeTab(docId, {
          tabId: input.tabId,
          baseVersion: current.version,
          markdown: current.markdown.replace("later", "user text"),
          origin: "editor",
        });
      }
      return writeTab(docId, input);
    };
    const edit = await mcp.tool("edit_tab", { tabId: tab.tabId, find: "TBD", replace: "done" });
    expect(edit.isError).toBe(false);
    expect(await Docs.getTabMarkdown(mcp.api.db, tab.tabId)).toBe(
      "## A\n\ndone\n\n## B\n\nuser text\n",
    );
  });

  it("returns the current version when write_tab conflicts", async () => {
    const mcp = await makeMcpHarness();
    const { tab } = await mcp.seedDoc("v2");
    const stale = await mcp.tool("write_tab", { tabId: tab.tabId, markdown: "x", baseVersion: 1 });
    expect(stale).toMatchObject({
      isError: true,
      body: { error: "version_conflict", currentVersion: 2 },
    });
    const fresh = await mcp.tool("write_tab", { tabId: tab.tabId, markdown: "x", baseVersion: 2 });
    expect(fresh.body.tab.version).toBe(3);
  });

  it("reads nested tabs in reading order, or one tab", async () => {
    const mcp = await makeMcpHarness();
    const { doc, tab } = await mcp.seedDoc("root");
    const second = await mcp.tool("create_tab", { docId: doc.docId, title: "Second" });
    const child = await mcp.tool("create_tab", {
      docId: doc.docId,
      title: "Child",
      parentTabId: tab.tabId,
      markdown: "nested",
    });
    expect(child.body.tab.url).toBe(`${ORIGIN}/d/${doc.docId}/${child.body.tab.tabId}`);

    const all = await mcp.tool("read_doc", { docId: doc.docId });
    expect(all.body.tabs.map((entry: { title: string }) => entry.title)).toEqual([
      "Plan",
      "Child",
      "Second",
    ]);
    const one = await mcp.tool("read_doc", { docId: doc.docId, tabId: second.body.tab.tabId });
    expect(one.body.tab).toMatchObject({ title: "Second", markdown: "", version: 1 });
  });

  it("renames tabs, sets status and lists docs by project", async () => {
    const mcp = await makeMcpHarness();
    const { doc, tab } = await mcp.seedDoc();
    const renamed = await mcp.tool("rename_tab", { tabId: tab.tabId, title: "Overview" });
    expect(renamed.body.tab.title).toBe("Overview");
    const status = await mcp.tool("set_doc_status", { docId: doc.docId, status: "plan" });
    expect(status.body.doc.status).toBe("plan");
    expect(mcp.api.broadcasts.at(-1)).toMatchObject({
      type: "doc.updated",
      doc: { id: doc.docId, status: "plan" },
    });
    const invalid = await mcp.tool("set_doc_status", { docId: doc.docId, status: "shipped" });
    expect(invalid.isError).toBe(true);

    const other = await mcp.tool("create_project", { name: "Other" });
    const listed = await mcp.tool("list_docs", { projectId: other.body.projectId });
    expect(listed.body.docs).toEqual([]);
    const everything = await mcp.tool("list_docs", {});
    expect(everything.body.docs[0]).toMatchObject({ docId: doc.docId, status: "plan" });
  });

  it("builds URLs from the public origin, not the request URL", async () => {
    const mcp = await makeMcpHarness("https://docs.upliftedconsulting.com");
    const { doc, tab } = await mcp.seedDoc();
    expect(doc.url).toBe(`${ORIGIN}/d/${doc.docId}/${tab.tabId}`);
  });

  it("lists the threads started from a doc in read_doc", async () => {
    const mcp = await makeMcpHarness();
    const { doc } = await mcp.seedDoc();
    await mcp.api.call("POST", `/api/docs/${doc.docId}/threads`, {
      body: { environmentId: "env-1", threadId: "thread-1", title: "Build it" },
      headers: { Cookie: mcp.cookie },
    });
    const read = await mcp.tool("read_doc", { docId: doc.docId });
    expect(read.body.startedThreads).toEqual([
      { environmentId: "env-1", threadId: "thread-1", title: "Build it" },
    ]);
  });

  it("moves and deletes tabs through the room, with clear errors", async () => {
    const mcp = await makeMcpHarness();
    const { doc, tab } = await mcp.seedDoc("root");
    const second = await mcp.tool("create_tab", { docId: doc.docId, title: "Second" });
    const secondId = second.body.tab.tabId;

    const moved = await mcp.tool("move_tab", { tabId: secondId, parentTabId: tab.tabId });
    expect(moved.body.tab).toMatchObject({ parentTabId: tab.tabId, position: 0 });
    expect(mcp.api.broadcasts.at(-1)).toMatchObject({ type: "tab.moved" });
    const cycle = await mcp.tool("move_tab", { tabId: tab.tabId, parentTabId: secondId });
    expect(cycle).toMatchObject({ isError: true, body: { error: "invalid_move" } });

    const last = await mcp.tool("delete_tab", { tabId: tab.tabId });
    expect(last).toMatchObject({ isError: true, body: { error: "last_tab" } });
    const deleted = await mcp.tool("delete_tab", { tabId: secondId });
    expect(deleted.body.deletedTabIds).toEqual([secondId]);
    expect(mcp.api.broadcasts.at(-1)).toMatchObject({ type: "tab.deleted" });
  });

  it("comments on a quote, replies and resolves, authored by the MCP client", async () => {
    const mcp = await makeMcpHarness();
    await mcp.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "1" },
    });
    const { doc, tab } = await mcp.seedDoc(
      "# Plan\n\nShip **v1** by Friday.\n\n## Risks\n\nNone yet.\n",
    );

    const created = await mcp.tool("create_comment", {
      tabId: tab.tabId,
      quote: "**v1** by Friday",
      body: "Is Friday realistic?",
    });
    expect(created.body.comment).toMatchObject({
      author: "agent:claude-code",
      quote: "v1 by Friday",
    });
    expect(mcp.api.broadcasts.at(-1)).toMatchObject({ type: "comment.created" });
    const threadId = created.body.comment.commentId;

    const reply = await mcp.tool("reply_comment", {
      commentId: threadId,
      body: "Moved to Monday.",
    });
    expect(reply.body.reply).toMatchObject({ threadId, author: "agent:claude-code" });

    // The quoted words are rewritten; the thread follows the passage.
    await mcp.tool("edit_tab", { tabId: tab.tabId, find: "by Friday", replace: "by Monday" });
    const open = await mcp.tool("list_comments", { docId: doc.docId });
    expect(open.body.threads).toEqual([
      expect.objectContaining({
        commentId: threadId,
        anchor: "anchored",
        resolved: false,
        replies: [expect.objectContaining({ body: "Moved to Monday." })],
      }),
    ]);

    const resolved = await mcp.tool("resolve_comment", { commentId: threadId });
    expect(resolved.body).toEqual({ threadId, resolved: true });
    expect((await mcp.tool("list_comments", { docId: doc.docId })).body.threads).toEqual([]);

    await mcp.tool("write_tab", { tabId: tab.tabId, markdown: "Rewritten.", baseVersion: 3 });
    const all = await mcp.tool("list_comments", { docId: doc.docId, includeResolved: true });
    expect(all.body.threads[0]).toMatchObject({ resolved: true, anchor: "text_removed" });
  });

  it("names the token as author without clientInfo, and refuses a missing or ambiguous quote", async () => {
    const mcp = await makeMcpHarness();
    const { tab } = await mcp.seedDoc("TBD here.\n\nTBD there.\n");
    const missing = await mcp.tool("create_comment", {
      tabId: tab.tabId,
      quote: "Done",
      body: "?",
    });
    expect(missing).toMatchObject({ isError: true, body: { error: "quote_not_found" } });
    const ambiguous = await mcp.tool("create_comment", {
      tabId: tab.tabId,
      quote: "TBD",
      body: "?",
    });
    expect(ambiguous).toMatchObject({ isError: true, body: { error: "ambiguous_quote" } });
    expect(ambiguous.body.message).toContain("2 times");

    const created = await mcp.tool("create_comment", {
      tabId: tab.tabId,
      quote: "TBD there",
      body: "Fill this in.",
    });
    expect(created.body.comment.author).toBe("agent:agent");
    const unknown = await mcp.tool("reply_comment", { commentId: "nope", body: "x" });
    expect(unknown).toMatchObject({ isError: true, body: { error: "not_found" } });
  });
});
