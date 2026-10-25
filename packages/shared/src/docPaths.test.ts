import { describe, expect, it } from "vite-plus/test";

import {
  docExcerpt,
  docTitleFromPath,
  isMarkdownPath,
  nextDocPath,
  slugifyDocTitle,
} from "./docPaths.ts";

describe("docPaths", () => {
  it("previews a doc as plain text without its title heading", () => {
    expect(
      docExcerpt("# Plan\n\nShip **on time**. See [brief](https://x.test).\n\n- [ ] One\n- Two\n"),
    ).toBe("Ship on time. See brief. One Two");
    expect(docExcerpt(`# T\n\n${"word ".repeat(100)}`, 20)).toBe("word word word word…");
  });

  it("slugifies titles to ASCII, falling back to untitled", () => {
    expect(slugifyDocTitle("Q3 Launch: Café Plan!")).toBe("q3-launch-cafe-plan");
    expect(slugifyDocTitle("???")).toBe("untitled");
    expect(slugifyDocTitle(`${"a".repeat(79)} b`)).toBe("a".repeat(79));
  });

  it("never picks an existing path, comparing case-insensitively", () => {
    expect(nextDocPath("docs", "Plan", new Set())).toBe("docs/plan.md");
    expect(nextDocPath("docs", "Plan", new Set(["docs/plan.md", "docs/plan-2.md"]))).toBe(
      "docs/plan-3.md",
    );
  });

  it("derives a title from the file name and recognises markdown", () => {
    expect(docTitleFromPath("docs/specs/launch_plan-v2.md")).toBe("launch plan v2");
    expect(isMarkdownPath("docs/a.MD")).toBe(true);
    expect(isMarkdownPath("docs/a.mdx")).toBe(false);
  });
});
