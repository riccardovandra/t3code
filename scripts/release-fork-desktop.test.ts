import { assert, describe, it } from "@effect/vitest";

import {
  appUpdateYmlNamesRepository,
  assertForkRepository,
  assertReleasableVersion,
  expectedMacArtifacts,
  parseGitHubRepository,
  parseRemoteTags,
  resolveNextVersion,
} from "./release-fork-desktop.ts";

describe("release-fork-desktop", () => {
  it("parses owner/repo from GitHub remotes", () => {
    assert.equal(
      parseGitHubRepository("https://github.com/riccardovandra/t3code"),
      "riccardovandra/t3code",
    );
    assert.equal(parseGitHubRepository("https://github.com/a/b.git\n"), "a/b");
    assert.equal(parseGitHubRepository("git@github.com:a/b.git"), "a/b");
    assert.equal(parseGitHubRepository("https://gitlab.com/a/b"), undefined);
  });

  it("refuses to publish to the upstream repository", () => {
    assert.throws(() => assertForkRepository("pingdotgg/t3code"), /Refusing/);
    assert.throws(() => assertForkRepository("PingDotGG/T3Code"), /Refusing/);
    assert.throws(() => assertForkRepository("not-a-repo"), /Invalid/);
    assertForkRepository("riccardovandra/t3code");
  });

  it("bumps the patch of the highest plain semver tag", () => {
    const tags = [
      "v0.0.45",
      "v0.1.0",
      "v0.1.1-preview.20261019.3339",
      "v0.2.0-nightly.20261019.1",
      "v0.1.3",
    ];
    assert.equal(resolveNextVersion(tags, "0.1.0"), "0.1.4");
    assert.equal(resolveNextVersion([], "0.1.0"), "0.1.1");
    assert.equal(resolveNextVersion(["v0.0.9"], "0.1.0"), "0.1.1");
  });

  it("rejects prerelease versions and existing tags", () => {
    assert.throws(() => assertReleasableVersion("0.1.2-preview.1", []), /plain/);
    assert.throws(() => assertReleasableVersion("0.1.2", ["v0.1.2"]), /already exists/);
    assertReleasableVersion("0.1.2", ["v0.1.1"]);
  });

  it("parses ls-remote tags including peeled refs", () => {
    assert.deepEqual(
      parseRemoteTags("abc\trefs/tags/v0.1.0\ndef\trefs/tags/v0.1.0^{}\n123\trefs/heads/main\n"),
      ["v0.1.0"],
    );
  });

  it("lists the macOS artifacts the updater feed needs", () => {
    assert.deepEqual(expectedMacArtifacts("0.1.2", "arm64"), [
      "UP-Orchestrator-0.1.2-arm64.dmg",
      "UP-Orchestrator-0.1.2-arm64.dmg.blockmap",
      "UP-Orchestrator-0.1.2-arm64.zip",
      "UP-Orchestrator-0.1.2-arm64.zip.blockmap",
      "latest-mac.yml",
    ]);
  });

  it("checks that app-update.yml names the fork", () => {
    const yml = "owner: riccardovandra\nrepo: t3code\nprovider: github\nreleaseType: release\n";
    assert.isTrue(appUpdateYmlNamesRepository(yml, "riccardovandra/t3code"));
    assert.isFalse(appUpdateYmlNamesRepository(yml, "pingdotgg/t3code"));
  });
});
