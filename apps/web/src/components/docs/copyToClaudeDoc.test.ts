import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "~/providerInstances";

import {
  buildCopyToClaudeDocPrompt,
  claudeDocInstances,
  copyToClaudeDocThreadTitle,
  parseCopyToClaudeDocMessage,
} from "./copyToClaudeDoc";

const ORIGIN = "https://docs.example.com";
const DOC_ID = "2f6c1a3e-9b1d-4c55-8a7e-0d3f1b2c4d5e";
const message = (overrides: Record<string, unknown> = {}) => ({
  type: "t3-docs:copy-to-claude-doc",
  docId: DOC_ID,
  title: "Launch plan",
  url: `${ORIGIN}/d/${DOC_ID}`,
  ...overrides,
});

function provider(driver: string, instanceId: string, enabled = true): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("parseCopyToClaudeDocMessage", () => {
  it("accepts the frame's message for a doc on the configured origin", () => {
    expect(parseCopyToClaudeDocMessage(message(), ORIGIN)).toEqual({
      docId: DOC_ID,
      title: "Launch plan",
      url: `${ORIGIN}/d/${DOC_ID}`,
    });
  });

  it("names an untitled doc", () => {
    expect(parseCopyToClaudeDocMessage(message({ title: "  " }), ORIGIN)?.title).toBe("Untitled");
  });

  it.each([
    ["another message type", message({ type: "t3-docs:location" })],
    ["a URL on another origin", message({ url: `https://evil.example/d/${DOC_ID}` })],
    ["a URL for another doc", message({ url: `${ORIGIN}/d/other` })],
    ["a doc id that is not an id", message({ docId: "a b", url: `${ORIGIN}/d/a%20b` })],
    ["a missing title", message({ title: undefined })],
    ["an oversized title", message({ title: "x".repeat(501) })],
    ["a malformed URL", message({ url: "not a url" })],
    ["a non-object", "t3-docs:copy-to-claude-doc"],
  ])("rejects %s", (_name, value) => {
    expect(parseCopyToClaudeDocMessage(value, ORIGIN)).toBeNull();
  });
});

describe("claudeDocInstances", () => {
  it("keeps only enabled Claude instances", () => {
    const entries = deriveProviderInstanceEntries([
      provider("claudeAgent", "claudeAgent"),
      provider("claudeAgent", "claudeAgent_bark"),
      provider("claudeAgent", "claudeAgent_old", false),
      provider("codex", "codex"),
    ]);
    expect(claudeDocInstances(entries).map((entry) => entry.instanceId)).toEqual([
      "claudeAgent",
      "claudeAgent_bark",
    ]);
  });
});

describe("buildCopyToClaudeDocPrompt", () => {
  const request = { docId: DOC_ID, title: 'Plan "B"', url: `${ORIGIN}/d/${DOC_ID}` };
  const prompt = buildCopyToClaudeDocPrompt(request);

  it("points the agent at the doc", () => {
    expect(prompt).toContain(`read_doc, docId "${DOC_ID}"`);
    expect(prompt).toContain(request.url);
    expect(prompt).toContain('titled exactly "Plan \\"B\\""');
  });

  it("asks for the same tab tree and mermaid diagrams", () => {
    expect(prompt).toContain("same nesting");
    expect(prompt).toContain("mermaid");
  });

  it("tells the agent to stop when Claude Docs is missing instead of improvising", () => {
    expect(prompt).toContain("If either is missing, stop");
    expect(prompt).toContain("Do not create a local file");
  });

  it("titles the thread after the doc", () => {
    expect(copyToClaudeDocThreadTitle(request)).toBe('Copy to Claude Doc: Plan "B"');
  });
});
