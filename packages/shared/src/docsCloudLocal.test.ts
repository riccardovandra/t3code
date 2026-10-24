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
    ).toEqual({ files: [{ path: "docs/a.md", title: "a" }] });
  });

  it("carries the disk file on a conflict", () => {
    const file = { path: "docs/a.md", markdown: "new", version: "v3", readOnlyReason: null };
    expect(parseLocalResult("file.write", { status: "conflict", file })).toEqual({
      status: "conflict",
      file,
    });
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
