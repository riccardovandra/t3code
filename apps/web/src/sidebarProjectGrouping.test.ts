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
      resolveScopedNewThreadProjectRef({ groups, scopeKey: null, contextProjectRef: other }),
    ).toBeNull();
  });

  it("uses the filtered project even when the open thread is elsewhere", () => {
    expect(
      resolveScopedNewThreadProjectRef({ groups, scopeKey: "app", contextProjectRef: other }),
    ).toEqual(local);
  });

  it("keeps the open thread's environment when it belongs to the filtered project", () => {
    expect(
      resolveScopedNewThreadProjectRef({ groups, scopeKey: "app", contextProjectRef: remote }),
    ).toEqual(remote);
  });

  it("returns nothing when the filtered project no longer exists", () => {
    expect(
      resolveScopedNewThreadProjectRef({ groups, scopeKey: "gone", contextProjectRef: null }),
    ).toBeNull();
  });
});
