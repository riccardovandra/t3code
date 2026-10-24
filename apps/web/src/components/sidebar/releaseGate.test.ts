import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ServerUpdateTarget } from "../ServerUpdateAction";
import { gateServersOnRelease } from "./releaseGate";

function server(id: string, selfUpdate: ServerUpdateTarget["selfUpdate"]): ServerUpdateTarget {
  return {
    environmentId: EnvironmentId.make(id),
    serverLabel: id,
    selfUpdate,
    installation: undefined,
    desktopAppUpdate: selfUpdate === "desktop-managed",
    threadContinuation: false,
    continueThreadsAfterServerUpdate: false,
    targetVersion: "0.1.8",
  };
}

const servers = [
  server("npm-service", "boot-service"),
  server("mirror-service", "boot-service"),
  server("other-desktop", "desktop-managed"),
];
const releaseMirrors = new Set([EnvironmentId.make("mirror-service")]);
const gate = (npmPublished: boolean, mirrorPublished: ReadonlyArray<string>) => {
  const result = gateServersOnRelease({
    servers,
    targetVersion: "0.1.8",
    releaseMirrors,
    npmPublished,
    mirrorPublished: new Set(mirrorPublished.map((id) => EnvironmentId.make(id))),
  });
  return {
    servers: result.servers.map((target) => target.serverLabel),
    skipped: result.skipped.map((entry) => [entry.label, entry.reason]),
  };
};

describe("gateServersOnRelease", () => {
  it("includes a release-mirror server once its mirror has the version, without npm", () => {
    expect(gate(false, ["mirror-service"])).toEqual({
      servers: ["mirror-service", "other-desktop"],
      skipped: [["npm-service", "t3@0.1.8 is not on npm yet"]],
    });
  });

  it("skips a release-mirror server until its mirror has the version, even once npm has it", () => {
    expect(gate(true, [])).toEqual({
      servers: ["npm-service", "other-desktop"],
      skipped: [["mirror-service", "T3 Code 0.1.8 is not on its release mirror yet"]],
    });
  });

  it("includes every server once both sources have the version", () => {
    expect(gate(true, ["mirror-service"]).servers).toEqual([
      "npm-service",
      "mirror-service",
      "other-desktop",
    ]);
  });
});
