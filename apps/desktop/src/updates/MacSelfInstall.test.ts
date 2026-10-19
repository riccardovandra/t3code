// @effect-diagnostics nodeBuiltinImport:off -- Exercises the real swap script against temporary directories.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  SWAP_SCRIPT,
  hasTeamIdentifier,
  resolveAppBundlePath,
  selectDownloadedFileSha512,
  sha512Matches,
} from "./MacSelfInstall.ts";

describe("MacSelfInstall", () => {
  it("resolves the app bundle from the executable path", () => {
    assert.deepEqual(
      resolveAppBundlePath("/Applications/T3 Code (Alpha).app/Contents/MacOS/T3 Code (Alpha)"),
      Option.some("/Applications/T3 Code (Alpha).app"),
    );
    assert.deepEqual(resolveAppBundlePath("/usr/local/bin/electron"), Option.none());
  });

  it("treats ad-hoc and unsigned bundles as lacking a Team ID", () => {
    assert.isFalse(
      hasTeamIdentifier("Executable=/x\nSignature=adhoc\nTeamIdentifier=not set\nSealed Resources"),
    );
    assert.isFalse(hasTeamIdentifier("/Applications/X.app: code object is not signed at all"));
    assert.isTrue(
      hasTeamIdentifier("Authority=Developer ID Application\nTeamIdentifier=ABCDE12345"),
    );
  });

  it("selects the checksum for the downloaded zip", () => {
    const update = {
      version: "1.2.4",
      downloadedFile: "/cache/pending/T3-Code-1.2.4-arm64.zip",
      files: [
        { url: "T3-Code-1.2.4-arm64.dmg", sha512: "dmg" },
        { url: "https://example.com/v1.2.4/T3-Code-1.2.4-arm64.zip", sha512: "zip" },
      ],
    };
    assert.deepEqual(selectDownloadedFileSha512(update), Option.some("zip"));
    assert.deepEqual(selectDownloadedFileSha512({ ...update, files: [] }), Option.none());
  });

  it("compares base64 sha512 digests", () => {
    const digest = NodeCrypto.createHash("sha512").update("update").digest();
    assert.isTrue(sha512Matches(digest.toString("base64"), digest));
    assert.isFalse(sha512Matches(Buffer.from("other").toString("base64"), digest));
  });

  it("swaps the bundle in place and reopens it", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-self-install-"));
    try {
      const target = NodePath.join(root, "Applications", "T3 Code.app");
      const stagingRoot = NodePath.join(root, "cache", "self-install");
      const staged = NodePath.join(stagingRoot, "extracted", "T3 Code.app");
      const stubBin = NodePath.join(root, "bin");
      const opened = NodePath.join(root, "opened");
      NodeFS.mkdirSync(target, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(target, "version"), "old");
      NodeFS.mkdirSync(staged, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(staged, "version"), "new");
      NodeFS.mkdirSync(stubBin);
      NodeFS.writeFileSync(
        NodePath.join(stubBin, "open"),
        `#!/bin/sh\nprintf '%s' "$1" > "${opened}"\n`,
        { mode: 0o755 },
      );
      const scriptPath = NodePath.join(root, "swap.sh");
      NodeFS.writeFileSync(scriptPath, SWAP_SCRIPT);

      // A finished child's pid stands in for the app that has already quit.
      const exitedPid = NodeChildProcess.spawnSync("/bin/sh", ["-c", "echo $$"], {
        encoding: "utf8",
      }).stdout.trim();
      const result = NodeChildProcess.spawnSync(
        "/bin/sh",
        [scriptPath, exitedPid, target, staged, stagingRoot],
        { env: { PATH: `${stubBin}:/usr/bin:/bin` } },
      );

      assert.equal(result.status, 0);
      assert.equal(NodeFS.readFileSync(NodePath.join(target, "version"), "utf8"), "new");
      assert.equal(NodeFS.readFileSync(opened, "utf8"), target);
      assert.isFalse(NodeFS.existsSync(stagingRoot));
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
