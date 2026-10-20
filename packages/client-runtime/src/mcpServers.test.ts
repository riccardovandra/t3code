import { McpServerId, type McpServerConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mcpOAuthRedirect,
  mcpServerDraft,
  mcpServerDraftDropsSignIn,
  mcpServerUpsertInput,
} from "./mcpServers.ts";

const id = McpServerId.make("server-1");
const timestamps = { createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" };
const redirectUri = "https://mac.tail1234.ts.net/oauth/mcp-client/callback";

const gamma: McpServerConfig = {
  id,
  name: "gamma",
  enabled: true,
  transport: { type: "http", url: "https://mcp.gamma.app/mcp" },
  auth: { type: "oauth", client: { clientId: "client-1", redirectUri, hasClientSecret: true } },
  ...timestamps,
};

const local: McpServerConfig = {
  id,
  name: "google",
  enabled: true,
  transport: {
    type: "stdio",
    command: "uvx",
    args: ["workspace-mcp", "--tools", "gmail drive"],
    env: { MODE: "single" },
    secretEnv: ["CLIENT_SECRET"],
  },
  auth: { type: "none" },
  ...timestamps,
};

describe("mcpServerUpsertInput", () => {
  it("keeps stored secrets when an edit leaves them blank", () => {
    expect(mcpServerUpsertInput(mcpServerDraft(gamma), redirectUri)).toEqual({
      ok: true,
      input: {
        id,
        name: "gamma",
        enabled: true,
        transport: { type: "http", url: "https://mcp.gamma.app/mcp" },
        auth: { type: "oauth", client: { clientId: "client-1", redirectUri } },
      },
    });
    const result = mcpServerUpsertInput(mcpServerDraft(local), null);
    expect(result.ok && result.input.transport).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["workspace-mcp", "--tools", "gmail drive"],
      env: { MODE: "single" },
      secretEnv: { CLIENT_SECRET: {} },
    });
  });

  it("requires a value for a new secret but not for a stored one", () => {
    const header = { ...mcpServerDraft(null), name: "notion", url: "https://mcp.notion.com/mcp" };
    expect(mcpServerUpsertInput({ ...header, auth: "header" }, null)).toEqual({
      ok: false,
      error: "Enter the header value.",
    });
    const draft = mcpServerDraft(local);
    const env = [...draft.env, { key: "API_KEY", value: "", secret: true, stored: false }];
    expect(mcpServerUpsertInput({ ...draft, env }, null)).toEqual({
      ok: false,
      error: "Enter a value for API_KEY.",
    });
  });

  it("rejects reserved names and a registered client without a known address", () => {
    expect(
      mcpServerUpsertInput({ ...mcpServerDraft(gamma), name: "t3-code" }, redirectUri),
    ).toEqual({ ok: false, error: "That name is reserved for T3 Code's own MCP server." });
    expect(mcpServerUpsertInput(mcpServerDraft(gamma), null).ok).toBe(false);
  });
});

describe("mcpServerDraftDropsSignIn", () => {
  it("warns only when the URL or registered client changes", () => {
    const draft = mcpServerDraft(gamma);
    expect(mcpServerDraftDropsSignIn(gamma, { ...draft, clientSecret: "new" })).toBe(false);
    expect(mcpServerDraftDropsSignIn(gamma, { ...draft, url: "https://other.test/mcp" })).toBe(
      true,
    );
    expect(mcpServerDraftDropsSignIn(gamma, { ...draft, registeredClient: false })).toBe(true);
  });
});

describe("mcpOAuthRedirect", () => {
  it("builds the callback on the environment's origin and flags loopback", () => {
    expect(mcpOAuthRedirect("https://mac.tail1234.ts.net/some/base/")).toEqual({
      uri: redirectUri,
      note: null,
    });
    expect(mcpOAuthRedirect("http://127.0.0.1:3773/")?.note).toContain("reject localhost");
    expect(mcpOAuthRedirect(null)).toBeNull();
  });
});
