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
    targetVersion: "0.1.8",
  };
}

const servers = [
  server("npm-service", "boot-service"),
  server("mirror-service", "boot-service"),
  server("other-desktop", "desktop-managed"),
];
const releaseMirrors = new Set([EnvironmentId.make("mirror-service")]);
const gate = (mirrorPublished: ReadonlyArray<string>) => {
  const result = gateServersOnRelease({
    servers,
    targetVersion: "0.1.8",
    releaseMirrors,
    mirrorPublished: new Set(mirrorPublished.map((id) => EnvironmentId.make(id))),
  });
  return {
    servers: result.servers.map((target) => target.serverLabel),
    skipped: result.skipped.map((entry) => [entry.label, entry.reason]),
  };
};

describe("gateServersOnRelease", () => {
  it("skips a release-mirror server until its mirror has the version", () => {
    expect(gate([])).toEqual({
      servers: ["npm-service", "other-desktop"],
      skipped: [["mirror-service", "T3 Code 0.1.8 is not on its release mirror yet"]],
    });
  });

  it("includes every server once the mirror has the version", () => {
    expect(gate(["mirror-service"])).toEqual({
      servers: ["npm-service", "mirror-service", "other-desktop"],
      skipped: [],
    });
  });
});
