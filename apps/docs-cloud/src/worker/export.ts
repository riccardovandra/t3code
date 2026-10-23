// Markdown export: one tab, or a whole doc with its tabs in reading order.

// Shared with the tab rail so export reads the doc in the order the user sees it.
// It is pure and imports only shared types, so the worker can use it.
import { orderTabs } from "../client/doc/tabTree.ts";
import type { DocWithTabs, Tab } from "../shared/protocol.ts";

const MAX_HEADING_LEVEL = 6;

function section(tab: Tab, depth: number): string {
  const level = Math.min(depth + 1, MAX_HEADING_LEVEL);
  const heading = `${"#".repeat(level)} ${tab.title}`;
  const body = tab.markdown.trim();
  return body ? `${heading}\n\n${body}\n` : `${heading}\n`;
}

export const tabMarkdown = (tab: Tab): string => section(tab, 0);

/** Every tab as a section whose heading level follows its depth in the tree. */
export const docMarkdown = (doc: DocWithTabs): string =>
  orderTabs(doc.tabs)
    .map(({ tab, depth }) => section(tab, depth))
    .join("\n");

/** An ASCII file stem, so it is safe in a quoted Content-Disposition filename. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export const markdownResponse = (markdown: string, title: string): Response =>
  new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(title)}.md"`,
      "Cache-Control": "no-store",
    },
  });
