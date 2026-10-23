import { describe, expect, it } from "vite-plus/test";

import { findQuote, locateAnchor, markdownToText } from "./anchors.ts";

const located = (text: string, anchor: Parameters<typeof locateAnchor>[1]) => {
  const range = locateAnchor(text, anchor);
  return range ? text.slice(range.start, range.end) : null;
};

describe("locateAnchor", () => {
  it("follows a passage that moved", () => {
    const anchor = { quote: "ships Friday", prefix: "The plan ", suffix: "." };
    const moved = "A new opening paragraph.\nMore context first.\nThe plan ships Friday.";
    expect(locateAnchor(moved, anchor)).toEqual({ start: 54, end: 66 });
  });

  it("prefers the repeated phrase whose context matches", () => {
    const text = "Ship it today. Later we ship it again.";
    expect(locateAnchor(text, { quote: "ship it", prefix: "Later we ", suffix: "" })).toEqual({
      start: 24,
      end: 31,
    });
  });

  it("stays with the passage when the quoted words themselves are edited", () => {
    const anchor = { quote: "500", prefix: "Intro.\nTeams reach ", suffix: " by the end of Q4." };
    expect(located("Intro.\nTeams reach 750 by the end of Q4.", anchor)).toBe("750");
  });

  it("stays with a rewritten sentence whose neighbouring words also changed", () => {
    const anchor = {
      quote: "consistent YouTube content",
      prefix: "strong client outcomes.\nPublish ",
      suffix: " that turns practical AI orchestration lessons",
    };
    const text =
      "strong client outcomes.\nPublish two YouTube videos per week that turn practical AI";
    expect(located(text, anchor)).toBe("two YouTube videos per week");
  });

  it("reports a removed passage", () => {
    const anchor = { quote: "Friday", prefix: "ships ", suffix: "." };
    expect(locateAnchor("The plan ships Monday.", anchor)).toBeNull();
  });
});

describe("markdownToText", () => {
  it("matches the editor's visible text", () => {
    const markdown = [
      "# Plan",
      "",
      "Ship **by Friday**, see [the brief](https://x.test) and `code`.",
      "",
      "- [ ] first task",
      "1. numbered item",
      "> quoted snake_case_name",
      "",
      "| A | B |",
      "| --- | --- |",
      "| one | two |",
      "",
      "```mermaid",
      "graph TD",
      "",
      "  A --> B",
      "```",
      "",
      "---",
      "Escaped \\*stars\\*.",
    ].join("\n");
    expect(markdownToText(markdown)).toBe(
      [
        "Plan",
        "Ship by Friday, see the brief and code.",
        "first task",
        "numbered item",
        "quoted snake_case_name",
        "A",
        "B",
        "one",
        "two",
        "graph TD",
        "",
        "  A --> B",
        "Escaped *stars*.",
      ].join("\n"),
    );
  });
});

describe("findQuote", () => {
  const text = markdownToText("# Goals\n\nShip **v1** by Friday.\n\nShip docs by Monday.");

  it("anchors a quote copied from markdown", () => {
    const match = findQuote(text, "**v1** by Friday");
    expect(match).toEqual({
      kind: "found",
      anchor: { quote: "v1 by Friday", prefix: "Goals\nShip ", suffix: ".\nShip docs by Monday." },
    });
  });

  it("reports a missing quote", () => {
    expect(findQuote(text, "by Sunday")).toEqual({ kind: "missing" });
  });

  it("reports an ambiguous quote", () => {
    expect(findQuote(text, "Ship")).toEqual({ kind: "ambiguous", count: 2 });
  });
});
