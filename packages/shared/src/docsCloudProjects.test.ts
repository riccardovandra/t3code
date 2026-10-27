import { describe, expect, it } from "vite-plus/test";

import {
  docsCloudProjectKey,
  docsCloudSyncEntries,
  normalizeProjectKey,
  projectNameFromKey,
} from "./docsCloudProjects.ts";

// A fork checkout as RepositoryIdentityResolver sees it: `upstream` wins the
// canonical key, and `origin`, the user's fork, is kept beside it.
const forkIdentity = {
  canonicalKey: "github.com/pingdotgg/t3code",
  rootPath: "/Users/r/Coding/t3code",
  origin: { canonicalKey: "github.com/riccardovandra/t3code" },
};

describe("docsCloudProjectKey", () => {
  it("keys a project by the user's own remote, else by its normalised title", () => {
    expect(
      docsCloudProjectKey({
        title: "T3 Code",
        repositoryIdentity: { canonicalKey: "github.com/riccardovandra/t3code" },
      }),
    ).toBe("github.com/riccardovandra/t3code");
    expect(docsCloudProjectKey({ title: "T3 Code", repositoryIdentity: forkIdentity })).toBe(
      "github.com/riccardovandra/t3code",
    );
    expect(
      docsCloudProjectKey({ title: "  Herbox   NETHERLANDS ", repositoryIdentity: null }),
    ).toBe("title:herbox netherlands");
  });
});

describe("docsCloudSyncEntries", () => {
  it("names a repository's project after its checkout, not the last project on it", () => {
    const entries = docsCloudSyncEntries([
      {
        title: "server",
        workspaceRoot: "/Users/r/Coding/t3code/apps/server",
        repositoryIdentity: forkIdentity,
      },
      {
        title: "T3 Code + AI PM",
        workspaceRoot: "/Users/r/Coding/t3code/",
        repositoryIdentity: forkIdentity,
      },
      {
        title: "server",
        workspaceRoot: "/Users/r/.t3/worktrees/t3code/feature/apps/server",
        repositoryIdentity: { ...forkIdentity, rootPath: "/Users/r/.t3/worktrees/t3code/feature" },
      },
      { title: "Notes", workspaceRoot: "/Users/r/notes", repositoryIdentity: null },
    ]);
    expect(entries).toEqual([
      { key: "github.com/riccardovandra/t3code", name: "T3 Code + AI PM" },
      { key: "title:notes", name: "Notes" },
    ]);
  });

  it("falls back to the shortest root when no project is the repository's root", () => {
    const identity = { ...forkIdentity, rootPath: "/repo" };
    expect(
      docsCloudSyncEntries([
        { title: "web", workspaceRoot: "/repo/apps/web", repositoryIdentity: identity },
        { title: "apps", workspaceRoot: "/repo/apps", repositoryIdentity: identity },
      ]),
    ).toEqual([{ key: "github.com/riccardovandra/t3code", name: "apps" }]);
  });
});

describe("normalizeProjectKey", () => {
  it("normalises title keys and refuses empty or oversized ones", () => {
    expect(normalizeProjectKey("Title:  Herbox   Netherlands ")).toBe("title:herbox netherlands");
    expect(normalizeProjectKey(" github.com/Owner/Repo ")).toBe("github.com/Owner/Repo");
    expect(normalizeProjectKey("title:  ")).toBeNull();
    expect(normalizeProjectKey(" ")).toBeNull();
    expect(normalizeProjectKey("x".repeat(301))).toBeNull();
  });

  it("names a key nobody named after its repository or title", () => {
    expect(projectNameFromKey("github.com/riccardovandra/t3code")).toBe("t3code");
    expect(projectNameFromKey("title:upwork-digest")).toBe("upwork-digest");
  });
});
