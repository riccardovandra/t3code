import type { McpServerEntry, McpServerId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  docsCloudConfig,
  docsCloudPath,
  docsCloudToolEvent,
  docsCloudUpsertInput,
} from "./docsCloud.ts";

const BASE = "https://docs.example.com";
const serverId = "docs-1" as McpServerId;

function entry(patch: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: serverId,
    name: "docs-cloud",
    enabled: true,
    transport: { type: "http", url: `${BASE}/mcp` },
    auth: { type: "header", header: "Authorization" },
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
    status: { state: "idle" },
    ...patch,
  } as McpServerEntry;
}

const tab = {
  tabId: "tab-2",
  title: "Risks",
  parentTabId: null,
  position: 1,
  version: 1,
  url: `${BASE}/d/doc-1/tab-2`,
};
const mcpResult = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

describe("docsCloudConfig", () => {
  it("reads the app origin from the hub entry", () => {
    expect(docsCloudConfig([entry()])).toEqual({ serverId, baseUrl: BASE, enabled: true });
    expect(docsCloudConfig([entry({ name: "notion" as McpServerEntry["name"] })])).toBeNull();
    expect(docsCloudConfig([])).toBeNull();
  });
});

describe("docsCloudUpsertInput", () => {
  it("registers the MCP endpoint with a bearer header", () => {
    expect(
      docsCloudUpsertInput({ baseUrl: `${BASE}/library/`, token: " dct_abc ", existing: null }),
    ).toEqual({
      ok: true,
      input: {
        name: "docs-cloud",
        transport: { type: "http", url: `${BASE}/mcp` },
        auth: { type: "header", header: "Authorization", secret: "Bearer dct_abc" },
      },
    });
    expect(
      docsCloudUpsertInput({ baseUrl: BASE, token: "Bearer dct_abc", existing: null }),
    ).toMatchObject({ ok: true, input: { auth: { secret: "Bearer dct_abc" } } });
  });

  it("keeps the stored token when updating without one", () => {
    const existing = docsCloudConfig([entry()]);
    expect(docsCloudUpsertInput({ baseUrl: BASE, token: "", existing })).toEqual({
      ok: true,
      input: {
        id: serverId,
        name: "docs-cloud",
        transport: { type: "http", url: `${BASE}/mcp` },
        auth: { type: "header", header: "Authorization" },
      },
    });
  });

  it("needs a URL, and a token the first time", () => {
    expect(docsCloudUpsertInput({ baseUrl: "docs", token: "t", existing: null }).ok).toBe(false);
    expect(docsCloudUpsertInput({ baseUrl: BASE, token: " ", existing: null }).ok).toBe(false);
  });
});

describe("docsCloudPath", () => {
  it("only maps URLs on the configured origin", () => {
    expect(docsCloudPath(`${BASE}/d/doc-1/tab-2`, BASE)).toBe("/d/doc-1/tab-2");
    expect(docsCloudPath("https://evil.example.com/d/doc-1/tab-2", BASE)).toBeNull();
    expect(docsCloudPath("not a url", BASE)).toBeNull();
  });
});

describe("docsCloudToolEvent", () => {
  const created = mcpResult({ doc: { docId: "doc-1", title: "Launch plan", url: tab.url }, tab });

  it("recognises create_doc and create_tab as each provider names them", () => {
    for (const toolName of [
      "mcp__docs-cloud__create_doc",
      "docs-cloud.create_doc",
      "docs-cloud_create_doc",
      "t3-mcp-1a2b3c4d-docs-cloud_create_doc",
      "mcp__docs_cloud__create_doc",
      "create_doc",
    ]) {
      expect(
        docsCloudToolEvent({ toolName, status: "completed", output: created }, BASE),
      ).toMatchObject({ kind: "doc-created", path: "/d/doc-1/tab-2" });
    }
    expect(
      docsCloudToolEvent(
        { toolName: "docs-cloud.create_tab", status: "completed", output: mcpResult({ tab }) },
        BASE,
      ),
    ).toEqual({
      kind: "tab-added",
      path: "/d/doc-1/tab-2",
      ref: { url: tab.url, docId: "doc-1", tabId: "tab-2", tabTitle: "Risks" },
    });
  });

  it("ignores other servers, other origins, failures and unfinished calls", () => {
    const call = (patch: Record<string, unknown>) =>
      docsCloudToolEvent(
        { toolName: "mcp__docs-cloud__create_doc", status: "completed", output: created, ...patch },
        BASE,
      );
    expect(call({ toolName: "mcp__notion__create_doc" })).toBeNull();
    expect(call({ toolName: "mcp__docs-cloud__read_doc" })).toBeNull();
    expect(call({ status: "inProgress" })).toBeNull();
    expect(call({ output: { ...created, isError: true } })).toBeNull();
    expect(
      docsCloudToolEvent(
        { toolName: "create_doc", status: "completed", output: created },
        "https://other.example.com",
      ),
    ).toBeNull();
  });
});
