import { describe, expect, it } from "vite-plus/test";

import {
  docsCloudProjectKey,
  normalizeProjectKey,
  projectNameFromKey,
} from "./docsCloudProjects.ts";

describe("docsCloudProjectKey", () => {
  it("keys a project by its own remote, else by its normalised title", () => {
    expect(
      docsCloudProjectKey({
        title: "T3 Code",
        repositoryIdentity: { canonicalKey: "github.com/riccardovandra/t3code" },
      }),
    ).toBe("github.com/riccardovandra/t3code");
    // A fork keeps its own project rather than joining its parent's.
    expect(
      docsCloudProjectKey({
        title: "T3 Code",
        repositoryIdentity: {
          canonicalKey: "github.com/riccardovandra/t3code",
          origin: { canonicalKey: "github.com/pingdotgg/t3code" },
        } as { canonicalKey: string },
      }),
    ).toBe("github.com/riccardovandra/t3code");
    expect(
      docsCloudProjectKey({ title: "  Herbox   NETHERLANDS ", repositoryIdentity: null }),
    ).toBe("title:herbox netherlands");
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
