import { flattenExtensions } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vite-plus/test";

import { codeFence } from "./codeBlock.ts";
import { FLOW_EXAMPLE } from "../../shared/widget/testing/examples.ts";
import { createEditorExtensions } from "./extensions.ts";

const markdown = new MarkdownManager({ extensions: flattenExtensions(createEditorExtensions()) });
const roundTrip = (source: string) => markdown.serialize(markdown.parse(source));

describe("code block markdown", () => {
  it.each([
    [
      "a diagram between paragraphs",
      "# Overlap\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter.",
    ],
    ["blank lines inside the source", "```mermaid\ngraph TD\n\n  A-->B\n\n```"],
    ["a tilde fence", "~~~mermaid\nflowchart LR\n  A --> B\n~~~"],
    ["a longer fence around backticks", "````mermaid\nflowchart LR\n  A[```] --> B\n````"],
    ["a plain code block", "```ts\nconst a = 1;\n```"],
    ["a diagram widget", `\`\`\`t3-widget id=release-flow\n${FLOW_EXAMPLE}\n\`\`\``],
    [
      "a multi-line widget among prose",
      "Intro.\n\n```t3-widget id=a\nconst W = 1;\n\nexport default () => (\n  <svg viewBox='0 0 760 40'>\n    <text data-claude-text-id='t'>Hi &amp; bye</text>\n  </svg>\n);\n```\n\nAfter.",
    ],
  ])("keeps %s byte-stable", (_, source) => {
    expect(roundTrip(source)).toBe(source);
  });

  it("parses a mermaid block as a code block with its language", () => {
    const doc = markdown.parse("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(doc.content?.[0]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [{ type: "text", text: "flowchart LR\n  A --> B" }],
    });
  });
});

describe("codeFence", () => {
  it("outgrows a fence-length line inside the source", () => {
    expect(codeFence("a\n```\nb", null)).toBe("````");
    expect(codeFence("a\n~~~~\nb", "~~~")).toBe("~~~~~");
  });

  it("ignores backticks that cannot close the block", () => {
    expect(codeFence("A[```] --> B", null)).toBe("```");
    expect(codeFence("a\n```\nb", "~~~")).toBe("~~~");
  });
});
