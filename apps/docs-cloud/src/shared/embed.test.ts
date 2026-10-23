import { describe, expect, it } from "vite-plus/test";

import { parseParentMessage, projectNameKey } from "./embed.ts";

describe("parseParentMessage", () => {
  it("keeps only the features this app knows from hello", () => {
    expect(parseParentMessage({ type: "t3-docs:hello" })).toEqual({
      type: "t3-docs:hello",
      features: [],
    });
    expect(
      parseParentMessage({ type: "t3-docs:hello", features: ["start-work", "teleport", 3] }),
    ).toEqual({ type: "t3-docs:hello", features: ["start-work"] });
  });

  it("accepts app paths only for navigate", () => {
    expect(parseParentMessage({ type: "t3-docs:navigate", path: "/d/doc-1" })).toEqual({
      type: "t3-docs:navigate",
      path: "/d/doc-1",
    });
    expect(parseParentMessage({ type: "t3-docs:navigate", path: "//evil.test" })).toBeNull();
    expect(parseParentMessage({ type: "t3-docs:navigate", path: "https://evil.test" })).toBeNull();
  });

  it("takes the project context as a trimmed name or null", () => {
    expect(parseParentMessage({ type: "t3-docs:context", projectName: " Site " })).toEqual({
      type: "t3-docs:context",
      projectName: "Site",
    });
    expect(parseParentMessage({ type: "t3-docs:context", projectName: "   " })).toEqual({
      type: "t3-docs:context",
      projectName: null,
    });
    expect(parseParentMessage({ type: "t3-docs:context", projectName: 3 })).toBeNull();
    expect(projectNameKey("  Uplifted   SITE ")).toBe(projectNameKey("uplifted site"));
  });

  it("validates thread links and drops malformed thread entries", () => {
    const link = {
      type: "t3-docs:link-thread",
      docId: "doc-1",
      environmentId: "env-1",
      threadId: "thread-1",
      title: "Build it",
    };
    expect(parseParentMessage({ ...link, extra: true })).toEqual(link);
    expect(parseParentMessage({ ...link, title: "" })).toBeNull();
    expect(parseParentMessage({ ...link, threadId: 7 })).toBeNull();
    expect(
      parseParentMessage({
        type: "t3-docs:threads",
        threads: [
          { environmentId: "env-1", threadId: "thread-1", title: "Build it" },
          { environmentId: "env-1", threadId: "thread-2" },
          "nope",
        ],
      }),
    ).toEqual({
      type: "t3-docs:threads",
      threads: [{ environmentId: "env-1", threadId: "thread-1", title: "Build it" }],
    });
  });

  it("validates comment results and ignores unknown types", () => {
    expect(
      parseParentMessage({ type: "t3-docs:comment-sent", requestId: "r-1", error: null }),
    ).toEqual({ type: "t3-docs:comment-sent", requestId: "r-1", error: null });
    expect(parseParentMessage({ type: "t3-docs:comment-sent", requestId: "r-1" })).toBeNull();
    expect(parseParentMessage({ type: "t3-docs:other" })).toBeNull();
    expect(parseParentMessage("t3-docs:hello")).toBeNull();
  });
});
