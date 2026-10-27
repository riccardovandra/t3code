import { describe, expect, it } from "vite-plus/test";

import { parseEnvBlock, parseSecretCommand, secretSavedDraft } from "./secretCommand";

describe("parseSecretCommand", () => {
  it("reads the key names after the command", () => {
    expect(parseSecretCommand("/secret OPENAI_API_KEY, RESEND_API_KEY")).toEqual([
      "OPENAI_API_KEY",
      "RESEND_API_KEY",
    ]);
    expect(parseSecretCommand("  /Secret  ")).toEqual([]);
  });

  it("drops invalid and repeated names", () => {
    expect(parseSecretCommand("/secret A 1BAD A my-key B_2")).toEqual(["A", "B_2"]);
  });

  it("ignores text that is not the command", () => {
    expect(parseSecretCommand("/secrets A")).toBeNull();
    expect(parseSecretCommand("please run /secret A")).toBeNull();
    expect(parseSecretCommand("/secret A\nand more")).toBeNull();
  });
});

describe("parseEnvBlock", () => {
  it("reads assignments and skips comments and blanks", () => {
    expect(
      parseEnvBlock(
        [
          "# from Stripe",
          "export STRIPE_KEY=sk_test_1 # live later",
          "",
          'QUOTED="a b # c"',
          "SINGLE='x'",
          "EMPTY=",
          "not an assignment",
        ].join("\n"),
      ),
    ).toEqual([
      { name: "STRIPE_KEY", value: "sk_test_1" },
      { name: "QUOTED", value: "a b # c" },
      { name: "SINGLE", value: "x" },
    ]);
  });
});

describe("secretSavedDraft", () => {
  it("names the keys without values", () => {
    expect(secretSavedDraft(["A", "B"], ".env")).toBe(
      "I added A, B to .env. Read them from the environment and don't print the values.",
    );
  });
});
