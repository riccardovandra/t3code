import { assert, describe, it } from "@effect/vitest";

import { BRAND_NAME, PROTECTED, planForkBranding, renameProduct } from "./fork-brand.ts";

describe("fork-brand", () => {
  it("renames the product but keeps protected identifiers", () => {
    const source = [
      'const CODEX_CLIENT_NAME = "T3 Code";',
      'const message = "T3 Code could not start.";',
      '"Description=T3 Code server",',
    ].join("\n");
    assert.equal(
      renameProduct(source),
      [
        'const CODEX_CLIENT_NAME = "T3 Code";',
        `const message = "${BRAND_NAME} could not start.";`,
        '"Description=T3 Code server",',
      ].join("\n"),
    );
  });

  it("applies every rule to the current tree", () => {
    const { branded, originals } = planForkBranding();
    const buildScript = branded.get("scripts/build-desktop-artifact.ts");
    assert.isDefined(buildScript);
    assert.include(buildScript, 'artifactName: "UP-Orchestrator-${version}-${arch}.${ext}"');
    assert.include(buildScript, 'CFBundleAlternateNames: ["T3 Code"]');
    assert.include(branded.get("apps/desktop/package.json"), `"productName": "${BRAND_NAME}`);

    for (const [file, content] of branded) {
      for (const text of PROTECTED) {
        assert.equal(
          content.includes(text),
          originals.get(file)?.includes(text) ?? false,
          `${file} lost "${text}"`,
        );
      }
    }
  });
});
