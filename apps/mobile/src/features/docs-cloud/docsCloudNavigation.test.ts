import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { docsCloudNavigation, docsCloudUrl, freshDocsCloudTabs } from "./docsCloudNavigation";

const BASE = "https://docs.example.com";

describe("docsCloudUrl", () => {
  it("builds URLs on the configured origin only", () => {
    expect(docsCloudUrl(BASE, "/d/doc-1/tab-2")).toBe(`${BASE}/d/doc-1/tab-2`);
    expect(docsCloudUrl(BASE, "d/doc-1")).toBe(`${BASE}/d/doc-1`);
    expect(docsCloudUrl(BASE, "/")).toBe(`${BASE}/`);
    expect(docsCloudUrl(BASE, "//evil.example.com/d/doc-1")).toBeNull();
  });
});

describe("docsCloudNavigation", () => {
  it("keeps Docs Cloud in the screen and sends other links out", () => {
    expect(docsCloudNavigation(`${BASE}/sign-in?next=/d/doc-1`, BASE)).toBe("load");
    expect(docsCloudNavigation("about:blank", BASE)).toBe("load");
    expect(docsCloudNavigation("https://github.com/t3tools", BASE)).toBe("external");
    expect(docsCloudNavigation("http://docs.example.com/d/doc-1", BASE)).toBe("external");
    expect(docsCloudNavigation("javascript:alert(1)", BASE)).toBe("block");
    expect(docsCloudNavigation("tel:123", BASE)).toBe("block");
  });
});

function toolItem(id: string, toolName: string, value: unknown): OrchestrationV2ProjectedTurnItem {
  return {
    item: {
      id,
      type: "dynamic_tool",
      toolName,
      status: "completed",
      output: { content: [{ type: "text", text: JSON.stringify(value) }] },
    },
  } as unknown as OrchestrationV2ProjectedTurnItem;
}

const tab = (tabId: string, title: string) => ({
  tab: { tabId, title, url: `${BASE}/d/doc-1/${tabId}` },
});

describe("freshDocsCloudTabs", () => {
  const first = toolItem("item-1", "mcp__docs-cloud__create_tab", tab("tab-1", "Risks"));
  const second = toolItem("item-2", "docs-cloud.create_tab", tab("tab-2", "Budget"));

  it("treats the first look as a baseline and announces later tabs once", () => {
    const baseline = freshDocsCloudTabs(null, "thread-1", [first], BASE);
    expect(baseline.fresh).toEqual([]);

    const next = freshDocsCloudTabs(baseline.seen, "thread-1", [first, second], BASE);
    expect(next.fresh).toEqual([{ id: "item-2", path: "/d/doc-1/tab-2", tabTitle: "Budget" }]);

    expect(freshDocsCloudTabs(next.seen, "thread-1", [first, second], BASE).fresh).toEqual([]);
  });

  it("starts a new baseline for another thread and ignores created docs", () => {
    const baseline = freshDocsCloudTabs(null, "thread-1", [], BASE);
    expect(freshDocsCloudTabs(baseline.seen, "thread-2", [second], BASE).fresh).toEqual([]);

    const created = toolItem("item-3", "mcp__docs-cloud__create_doc", {
      doc: { docId: "doc-1", title: "Plan", url: `${BASE}/d/doc-1/tab-3` },
      ...tab("tab-3", "Overview"),
    });
    expect(freshDocsCloudTabs(baseline.seen, "thread-1", [created], BASE).fresh).toEqual([]);
  });
});
