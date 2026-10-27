import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveScopedNewThreadProjectRef } from "./sidebarProjectGrouping";

const local = { environmentId: EnvironmentId.make("env-local"), projectId: ProjectId.make("p1") };
const remote = { environmentId: EnvironmentId.make("env-remote"), projectId: ProjectId.make("p2") };
const other = { environmentId: EnvironmentId.make("env-local"), projectId: ProjectId.make("p3") };

const groups = [
  {
    projectKey: "app",
    environmentId: local.environmentId,
    id: local.projectId,
    memberProjectRefs: [local, remote],
  },
  {
    projectKey: "other",
    environmentId: other.environmentId,
    id: other.projectId,
    memberProjectRefs: [other],
  },
];

describe("resolveScopedNewThreadProjectRef", () => {
  it("returns nothing without a project filter", () => {
    expect(
      resolveScopedNewThreadProjectRef({ groups, scopeKeys: [], contextProjectRef: other }),
    ).toBeNull();
  });

  it("uses the filtered project even when the open thread is elsewhere", () => {
    expect(
      resolveScopedNewThreadProjectRef({ groups, scopeKeys: ["app"], contextProjectRef: other }),
    ).toEqual(local);
  });

  it("keeps the open thread's environment when it belongs to the filtered project", () => {
    expect(
      resolveScopedNewThreadProjectRef({ groups, scopeKeys: ["app"], contextProjectRef: remote }),
    ).toEqual(remote);
  });

  it("returns nothing when the filtered project no longer exists", () => {
    expect(
      resolveScopedNewThreadProjectRef({ groups, scopeKeys: ["gone"], contextProjectRef: null }),
    ).toBeNull();
  });

  it("uses the open thread's project when it is one of several filtered projects", () => {
    expect(
      resolveScopedNewThreadProjectRef({
        groups,
        scopeKeys: ["app", "other"],
        contextProjectRef: other,
      }),
    ).toEqual(other);
  });

  it("leaves the choice to the user when several projects are filtered and none is open", () => {
    expect(
      resolveScopedNewThreadProjectRef({
        groups,
        scopeKeys: ["app", "other"],
        contextProjectRef: null,
      }),
    ).toBeNull();
  });
});
