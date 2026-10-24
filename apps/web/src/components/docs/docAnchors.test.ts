import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDocTextIndex,
  captureDocAnchor,
  locateDocAnchor,
  resolveDocAnchor,
} from "./docAnchors";
import { unsupportedMarkdownReason } from "@t3tools/shared/docPaths";

const schema = getSchema([StarterKit]);
const doc = (...paragraphs: string[]) =>
  schema.node(
    "doc",
    null,
    paragraphs.map((text) => schema.node("paragraph", null, text ? [schema.text(text)] : [])),
  );

describe("doc anchors", () => {
  it("round-trips a selection across blocks", () => {
    const node = doc("Intro line", "The plan ships Friday.");
    const index = buildDocTextIndex(node);
    expect(index.text).toBe("Intro line\nThe plan ships Friday.");
    const from = index.positions[index.text.indexOf("line")]!;
    const to = index.positions[index.text.indexOf("plan") + 4]!;
    const anchor = captureDocAnchor(index, from, to);
    expect(anchor?.quote).toBe("line\nThe plan");
    expect(resolveDocAnchor(index, anchor!)).toEqual({ from, to });
  });

  it("trims whitespace from the captured quote", () => {
    const index = buildDocTextIndex(doc("alpha  beta  gamma"));
    const anchor = captureDocAnchor(index, index.positions[5]!, index.positions[13]!);
    expect(anchor).toMatchObject({ quote: "beta", prefix: "alpha  ", suffix: "  gamma" });
  });

  it("prefers the repeated phrase whose context matches", () => {
    const text = "Ship it today. Later we ship it again.";
    const located = locateDocAnchor(text, { quote: "ship it", prefix: "Later we ", suffix: "" });
    expect(located).toEqual({ start: 24, end: 31 });
  });

  it("stays with the passage when the quoted words themselves are edited", () => {
    const before = buildDocTextIndex(doc("Intro.", "Teams reach 500 by the end of Q4.", "Goals"));
    const from = before.positions[before.text.indexOf("500")]!;
    const anchor = captureDocAnchor(before, from, from + 3)!;
    const after = buildDocTextIndex(doc("Intro.", "Teams reach 750 by the end of Q4.", "Goals"));
    const range = resolveDocAnchor(after, anchor)!;
    expect(after.text.slice(after.positions.indexOf(range.from))).toMatch(/^750/);
  });

  it("stays with a rewritten sentence whose neighbouring words also changed", () => {
    const anchor = {
      quote: "consistent YouTube content",
      prefix: "strong client outcomes.\nPublish ",
      suffix: " that turns practical AI orchestration lessons",
    };
    const text =
      "strong client outcomes.\nPublish two YouTube videos per week that turn practical AI";
    const located = locateDocAnchor(text, anchor)!;
    expect(text.slice(located.start, located.end)).toBe("two YouTube videos per week");
  });

  it("survives edits before the quote and detaches when it is gone", () => {
    const anchor = { quote: "Friday", prefix: "ships ", suffix: "." };
    const edited = buildDocTextIndex(doc("A new opening paragraph.", "The plan ships Friday."));
    expect(resolveDocAnchor(edited, anchor)).not.toBeNull();
    expect(resolveDocAnchor(buildDocTextIndex(doc("The plan ships Monday.")), anchor)).toBeNull();
  });
});

describe("doc paths", () => {
  it("flags markdown the rich editor cannot preserve", () => {
    expect(unsupportedMarkdownReason("# Title\n\nPlain text and **bold**.\n")).toBeNull();
    expect(unsupportedMarkdownReason("| a | b |\n| --- | --- |\n| 1 | 2 |\n")).toBeNull();
    expect(unsupportedMarkdownReason("---\ntitle: x\n---\n# Doc\n")).toBe("front matter");
    expect(unsupportedMarkdownReason("<details>\n<summary>x</summary>\n</details>\n")).toBe(
      "HTML blocks",
    );
  });
});
