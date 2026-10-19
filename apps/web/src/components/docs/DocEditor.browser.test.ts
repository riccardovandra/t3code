import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vite-plus/test";

import { createDocEditorExtensions } from "./DocEditor";

const roundTrip = (markdown: string) => {
  const editor = new Editor({
    extensions: createDocEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  const result = editor.getMarkdown();
  editor.destroy();
  return result;
};

// Tables come back with padded columns and blank lines around them, which render the same.
const normalizeSpacing = (markdown: string) =>
  markdown
    .replace(/-{3,}/g, "---")
    .replace(/ +\|/g, " |")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

describe("doc editor markdown", () => {
  it("preserves the markdown the rich editor supports", () => {
    const markdown = [
      "# Launch plan",
      "",
      "Ship **on time** with *care* and `code`. See [the brief](https://example.com).",
      "",
      "## Steps",
      "",
      "- First",
      "- Second",
      "",
      "1. One",
      "2. Two",
      "",
      "- [ ] Open task",
      "- [x] Done task",
      "",
      "> A quote",
      "",
      "| Workstream | Owner |",
      "| --- | --- |",
      "| Connector | Platform |",
      "",
      "```ts",
      "const ok = true;",
      "```",
    ].join("\n");
    const saved = roundTrip(markdown);
    expect(normalizeSpacing(saved)).toBe(normalizeSpacing(markdown));
    // A second save must not rewrite the file again.
    expect(roundTrip(saved)).toBe(saved);
  });
});
