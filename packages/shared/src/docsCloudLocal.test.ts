import { describe, expect, it } from "vite-plus/test";

import {
  isLocalDocPath,
  localDocAppPath,
  localDocPathFromAppPath,
  localDocVersion,
  parseLocalRequestMessage,
  parseLocalResponseMessage,
  parseLocalResult,
} from "./docsCloudLocal.ts";

const request = (body: unknown) =>
  parseLocalRequestMessage({ type: "t3-docs:local-request", requestId: "r1", request: body });

describe("isLocalDocPath", () => {
  it("allows only markdown under docs/", () => {
    expect(isLocalDocPath("docs/plan.md")).toBe(true);
    expect(isLocalDocPath("docs/a/b/Plan.MD")).toBe(true);
    expect(isLocalDocPath("README.md")).toBe(false);
    expect(isLocalDocPath("docs/plan.txt")).toBe(false);
    expect(isLocalDocPath("docs/../package.md")).toBe(false);
    expect(isLocalDocPath("docs//x.md")).toBe(false);
    expect(isLocalDocPath("/docs/x.md")).toBe(false);
    expect(isLocalDocPath("docs\\..\\x.md")).toBe(false);
    expect(isLocalDocPath("docs/x\u0000.md")).toBe(false);
  });
});

describe("parseLocalRequestMessage", () => {
  it("accepts each request kind with its fields", () => {
    expect(request({ kind: "files.list" })?.request).toEqual({ kind: "files.list" });
    expect(request({ kind: "file.read", path: "docs/a.md", extra: 1 })?.request).toEqual({
      kind: "file.read",
      path: "docs/a.md",
    });
    expect(
      request({ kind: "file.write", path: "docs/a.md", markdown: "", baseVersion: "v1" })?.request,
    ).toEqual({ kind: "file.write", path: "docs/a.md", markdown: "", baseVersion: "v1" });
  });

  it("refuses unknown kinds, paths outside docs and missing fields", () => {
    expect(request({ kind: "file.delete", path: "docs/a.md" })).toBeNull();
    expect(request({ kind: "toString" })).toBeNull();
    expect(request({ kind: "file.read", path: "src/secret.md" })).toBeNull();
    expect(request({ kind: "file.write", path: "docs/a.md", markdown: "x" })).toBeNull();
    expect(
      parseLocalRequestMessage({ type: "t3-docs:local-request", request: { kind: "files.list" } }),
    ).toBeNull();
  });
});

describe("parseLocalResponseMessage and parseLocalResult", () => {
  it("parses the envelope, then checks the result by kind", () => {
    const ok = parseLocalResponseMessage({
      type: "t3-docs:local-response",
      requestId: "r1",
      ok: true,
      result: { status: "saved", version: "v2" },
    });
    expect(ok).toMatchObject({ ok: true, requestId: "r1" });
    expect(parseLocalResult("file.write", ok?.ok ? ok.result : null)).toEqual({
      status: "saved",
      version: "v2",
    });
    expect(parseLocalResult("file.read", { path: "docs/a.md", markdown: "x" })).toBeNull();
    expect(
      parseLocalResponseMessage({ type: "t3-docs:local-response", requestId: "r1", ok: false }),
    ).toBeNull();
  });

  it("drops listed files outside docs", () => {
    expect(
      parseLocalResult("files.list", {
        files: [
          { path: "docs/a.md", title: "a" },
          { path: "../etc/passwd.md", title: "x" },
        ],
      }),
    ).toEqual({ files: [{ path: "docs/a.md", title: "a", cloudDocId: null }] });
  });

  it("carries a listed file's Docs Cloud doc, dropping a malformed one", () => {
    expect(
      parseLocalResult("files.list", {
        files: [
          { path: "docs/a.md", title: "a", cloudDocId: "doc_1" },
          { path: "docs/b.md", title: "b", cloudDocId: 7 },
        ],
      }),
    ).toEqual({
      files: [
        { path: "docs/a.md", title: "a", cloudDocId: "doc_1" },
        { path: "docs/b.md", title: "b", cloudDocId: null },
      ],
    });
  });

  it("carries the disk file on a conflict", () => {
    const file = { path: "docs/a.md", markdown: "new", version: "v3", readOnlyReason: null };
    expect(parseLocalResult("file.write", { status: "conflict", file })).toEqual({
      status: "conflict",
      file,
    });
  });
});

describe("comment requests and results", () => {
  const anchor = { quote: "ship Friday", prefix: "We ", suffix: "." };

  it("accepts each comment kind with its fields", () => {
    expect(
      request({
        kind: "comment.create",
        path: "docs/a.md",
        ...anchor,
        body: "Why?",
        sendToAgent: true,
      })?.request,
    ).toEqual({
      kind: "comment.create",
      path: "docs/a.md",
      ...anchor,
      body: "Why?",
      sendToAgent: true,
    });
    const target = { path: "docs/a.md", commentId: "c1" };
    expect(request({ kind: "comments.list", path: "docs/a.md" })?.request).toEqual({
      kind: "comments.list",
      path: "docs/a.md",
    });
    expect(
      request({ kind: "comment.reply", ...target, body: "ok", sendToAgent: false })?.request,
    ).toEqual({ kind: "comment.reply", ...target, body: "ok", sendToAgent: false });
    expect(request({ kind: "comment.resolve", ...target, resolved: false })?.request).toEqual({
      kind: "comment.resolve",
      ...target,
      resolved: false,
    });
    expect(request({ kind: "comment.delete", ...target })?.request).toEqual({
      kind: "comment.delete",
      ...target,
    });
    expect(request({ kind: "comment.chat", ...target })?.request).toEqual({
      kind: "comment.chat",
      ...target,
    });
  });

  it("refuses comments the T3 server would refuse, and files outside docs", () => {
    const create = { kind: "comment.create", path: "docs/a.md", ...anchor, sendToAgent: false };
    expect(request({ ...create, body: "  " })).toBeNull();
    expect(request({ ...create, body: "x".repeat(10_001) })).toBeNull();
    expect(request({ ...create, body: "x", quote: "q".repeat(2_001) })).toBeNull();
    expect(request({ ...create, body: "x", prefix: "p".repeat(201) })).toBeNull();
    expect(request({ ...create, body: "x", path: "src/a.md" })).toBeNull();
    expect(request({ kind: "comment.create", path: "docs/a.md", ...anchor, body: "x" })).toBeNull();
    expect(request({ kind: "comment.resolve", path: "docs/a.md", commentId: "c1" })).toBeNull();
    expect(request({ kind: "comment.delete", path: "docs/a.md", commentId: "" })).toBeNull();
  });

  it("keeps well-formed comments and drops malformed ones", () => {
    const root = {
      id: "c1",
      parentId: null,
      ...anchor,
      body: "Why?",
      author: "user",
      resolvedAt: null,
      createdAt: 1,
    };
    const reply = { ...root, id: "c2", parentId: "c1", author: "agent", quote: "", createdAt: 2 };
    expect(
      parseLocalResult("comment.reply", {
        comments: [root, reply, { ...root, id: "c3", author: "someone" }, { ...root, id: 4 }],
        canComment: true,
        canSendToAgent: false,
      }),
    ).toEqual({ comments: [root, reply], canComment: true, canSendToAgent: false });
    expect(parseLocalResult("comments.list", { comments: [root] })).toBeNull();
    const state = { comments: [root], canComment: true, canSendToAgent: true };
    expect(parseLocalResult("comment.create", state)).toBeNull();
    expect(parseLocalResult("comment.create", { ...state, commentId: "c1" })).toEqual({
      ...state,
      commentId: "c1",
    });
    expect(parseLocalResult("comment.chat", { added: true })).toEqual({ added: true });
    expect(parseLocalResult("comment.chat", {})).toBeNull();
  });
});

describe("local routes", () => {
  it("round-trips a path through the app route", () => {
    const path = "docs/plans/Q3 roadmap.md";
    expect(localDocAppPath(path)).toBe("/local/docs/plans/Q3%20roadmap.md");
    expect(localDocPathFromAppPath(localDocAppPath(path))).toBe(path);
    expect(localDocPathFromAppPath("/local/src/x.md")).toBeNull();
    expect(localDocPathFromAppPath("/local/docs/%E0%A4%A.md")).toBeNull();
    expect(localDocPathFromAppPath("/d/doc-1")).toBeNull();
  });
});

describe("localDocVersion", () => {
  it("changes with the text", () => {
    expect(localDocVersion("# A\n")).toBe(localDocVersion("# A\n"));
    expect(localDocVersion("# A\n")).not.toBe(localDocVersion("# B\n"));
  });
});

describe("create and import", () => {
  it("accepts a title to create and a docs path to import", () => {
    expect(request({ kind: "file.create", title: "Q3 plan" })?.request).toEqual({
      kind: "file.create",
      title: "Q3 plan",
    });
    expect(request({ kind: "file.import", path: "docs/a.md", update: true })?.request).toEqual({
      kind: "file.import",
      path: "docs/a.md",
      update: true,
    });
  });

  it("refuses a blank or long title and imports outside docs", () => {
    expect(request({ kind: "file.create", title: "   " })).toBeNull();
    expect(request({ kind: "file.create", title: "x".repeat(201) })).toBeNull();
    expect(request({ kind: "file.create" })).toBeNull();
    expect(request({ kind: "file.import", path: "README.md", update: false })).toBeNull();
    expect(request({ kind: "file.import", path: "docs/a.md" })).toBeNull();
  });

  it("answers a create with the new file and an import with its doc", () => {
    const file = {
      path: "docs/q3-plan.md",
      markdown: "# Q3 plan\n",
      version: "v1",
      readOnlyReason: null,
    };
    expect(parseLocalResult("file.create", file)).toEqual(file);
    const imported = {
      status: "imported",
      cloudDocId: "doc_1",
      commentsImported: 2,
      commentsSkipped: 1,
    };
    expect(parseLocalResult("file.import", imported)).toEqual(imported);
    expect(parseLocalResult("file.import", { ...imported, status: "failed" })).toBeNull();
    expect(parseLocalResult("file.import", { ...imported, cloudDocId: "" })).toBeNull();
    expect(parseLocalResult("file.import", { ...imported, commentsSkipped: -1 })).toBeNull();
  });
});
