import { describe, expect, it } from "vite-plus/test";

import { speakableText, splitSentences } from "./readAloud";

describe("speakableText", () => {
  it("keeps the words and drops the markdown markers", () => {
    expect(
      speakableText(
        "## Why\nThe **sign-in** is accepted. See [the plan page](https://example.com/plan).\n\n- `converter.ts` keeps merged cells\n1. Open the pull request",
      ),
    ).toBe(
      "Why.\nThe sign-in is accepted. See the plan page.\nconverter.ts keeps merged cells\nOpen the pull request",
    );
  });

  it("skips code blocks, including one still being written", () => {
    expect(speakableText("Before.\n```ts\nconst a = 1;\n```\nAfter.")).toBe(
      "Before.\nCode block skipped.\nAfter.",
    );
    expect(speakableText("Before.\n```ts\nconst a = 1;")).toBe("Before.\nCode block skipped.");
  });

  it("reads a table row by row without the divider", () => {
    expect(speakableText("| Option | Cost |\n| --- | --- |\n| Built-in | Free |")).toBe(
      "Option, Cost.\nBuilt-in, Free.",
    );
  });

  it("leaves underscores inside identifiers alone", () => {
    expect(speakableText("Set T3CODE_DEV_AUTH_TOKEN in the file.")).toBe(
      "Set T3CODE_DEV_AUTH_TOKEN in the file.",
    );
  });
});

describe("splitSentences", () => {
  it("splits on sentence ends and line breaks, dropping fragments with nothing to say", () => {
    expect(splitSentences("One thing. Another thing?\nA heading\n---\nDone!")).toEqual([
      "One thing.",
      "Another thing?",
      "A heading",
      "Done!",
    ]);
  });
});
