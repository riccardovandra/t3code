import type { DocsCloudImportFileResult, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { localDocVersion, type LocalRequestMessage } from "@t3tools/shared/docsCloudLocal";
import { describe, expect, it } from "vite-plus/test";

import {
  answerLocalDocsRequest,
  LOCAL_FILE_HANDLERS,
  type LocalDocsContext,
  unsupportedLocalDocsReply,
} from "./docsCloudLocalHost.ts";

function context(
  options: {
    canWrite?: boolean;
    canImport?: boolean;
    truncated?: boolean;
    /** On disk but missing from the listing, as ignored files are. */
    unlisted?: ReadonlyArray<string>;
    importResult?: DocsCloudImportFileResult;
  } = {},
) {
  const disk = new Map([["docs/plan.md", "# Plan\n"]]);
  const unlisted = new Set(options.unlisted ?? []);
  for (const path of unlisted) disk.set(path, "");
  const writes: Array<[string, string]> = [];
  const imports: Array<[string, boolean]> = [];
  const value: LocalDocsContext = {
    environmentId: "env-1" as EnvironmentId,
    projectId: "project-1" as ProjectId,
    cwd: "/repo",
    canWrite: options.canWrite ?? true,
    canImport: options.canImport ?? true,
    files: {
      list: async () =>
        [...disk.keys()]
          .filter((path) => !unlisted.has(path))
          .map((path) => ({ path, title: "Plan", cloudDocId: null })),
      exists: async (path) => [...disk.keys()].some((key) => key.toLowerCase() === path),
      read: async (path) => {
        const contents = disk.get(path);
        if (contents === undefined) throw new Error(`No such file: ${path}`);
        return { contents, truncated: options.truncated ?? false };
      },
      write: async (path, contents) => {
        writes.push([path, contents]);
        disk.set(path, contents);
      },
      importToCloud: async (path, update) => {
        imports.push([path, update]);
        return (
          options.importResult ?? {
            docPath: path,
            status: update ? "updated" : "imported",
            doc: {
              docPath: path,
              docId: "doc_1",
              url: "https://docs.test/d/doc_1",
              importedAt: "2026-10-25T00:00:00.000Z",
            },
            error: null,
            commentsImported: 2,
            commentsSkipped: [{ commentId: "c1", quote: "gone", reason: "text_not_found" }],
          }
        );
      },
    },
  };
  return { value, disk, writes, imports };
}

const ask = (request: LocalRequestMessage["request"], ctx: LocalDocsContext) =>
  answerLocalDocsRequest(
    { type: "t3-docs:local-request", requestId: "r1", request },
    LOCAL_FILE_HANDLERS,
    ctx,
  );

describe("LOCAL_FILE_HANDLERS", () => {
  it("reads a file with its version", async () => {
    const { value } = context();
    expect(await ask({ kind: "file.read", path: "docs/plan.md" }, value)).toEqual({
      type: "t3-docs:local-response",
      requestId: "r1",
      ok: true,
      result: {
        path: "docs/plan.md",
        markdown: "# Plan\n",
        version: localDocVersion("# Plan\n"),
        readOnlyReason: null,
      },
    });
  });

  it("marks files read-only without write access or when truncated", async () => {
    const readOnly = await ask(
      { kind: "file.read", path: "docs/plan.md" },
      context({ canWrite: false }).value,
    );
    expect(readOnly).toMatchObject({
      result: { readOnlyReason: "This connection cannot edit files." },
    });
    const truncated = await ask(
      { kind: "file.read", path: "docs/plan.md" },
      context({ truncated: true }).value,
    );
    expect(truncated).toMatchObject({
      result: { readOnlyReason: "This file is too large to edit here." },
    });
  });

  it("writes on top of the version the editor read", async () => {
    const { value, disk } = context();
    const reply = await ask(
      {
        kind: "file.write",
        path: "docs/plan.md",
        markdown: "# Plan v2\n",
        baseVersion: localDocVersion("# Plan\n"),
      },
      value,
    );
    expect(reply).toMatchObject({
      ok: true,
      result: { status: "saved", version: localDocVersion("# Plan v2\n") },
    });
    expect(disk.get("docs/plan.md")).toBe("# Plan v2\n");
  });

  it("returns the disk text instead of overwriting a file that changed", async () => {
    const { value, disk, writes } = context();
    disk.set("docs/plan.md", "# Edited by the agent\n");
    const reply = await ask(
      {
        kind: "file.write",
        path: "docs/plan.md",
        markdown: "# Mine\n",
        baseVersion: localDocVersion("# Plan\n"),
      },
      value,
    );
    expect(reply).toMatchObject({
      ok: true,
      result: { status: "conflict", file: { markdown: "# Edited by the agent\n" } },
    });
    expect(writes).toEqual([]);
  });

  it("refuses writes without access and reports failures as errors", async () => {
    const { value, writes } = context({ canWrite: false });
    const base = localDocVersion("# Plan\n");
    expect(
      await ask(
        { kind: "file.write", path: "docs/plan.md", markdown: "x", baseVersion: base },
        value,
      ),
    ).toMatchObject({ ok: false, error: "This connection cannot edit files." });
    expect(writes).toEqual([]);
    expect(await ask({ kind: "file.read", path: "docs/gone.md" }, value)).toMatchObject({
      ok: false,
      error: "No such file: docs/gone.md",
    });
  });

  it("creates a new file under docs/ named after the title", async () => {
    const { value, disk } = context();
    const reply = await ask({ kind: "file.create", title: "  Q3   Launch: Café " }, value);
    expect(reply).toMatchObject({
      ok: true,
      result: {
        path: "docs/q3-launch-cafe.md",
        markdown: "# Q3 Launch: Café\n",
        version: localDocVersion("# Q3 Launch: Café\n"),
        readOnlyReason: null,
      },
    });
    expect(disk.get("docs/q3-launch-cafe.md")).toBe("# Q3 Launch: Café\n");
  });

  it("never overwrites a file, listed or not, whatever its case", async () => {
    const { value, disk, writes } = context({ unlisted: ["docs/Plan-2.md"] });
    const reply = await ask({ kind: "file.create", title: "Plan" }, value);
    expect(reply).toMatchObject({ ok: true, result: { path: "docs/plan-3.md" } });
    expect(writes).toEqual([["docs/plan-3.md", "# Plan\n"]]);
    expect(disk.get("docs/plan.md")).toBe("# Plan\n");
    // Titles that slugify to nothing still land inside docs/.
    expect(await ask({ kind: "file.create", title: "../../.." }, value)).toMatchObject({
      result: { path: "docs/untitled.md" },
    });
  });

  it("refuses to create without write access", async () => {
    const { value, writes } = context({ canWrite: false });
    expect(await ask({ kind: "file.create", title: "Plan" }, value)).toMatchObject({
      ok: false,
      error: "This connection cannot create files.",
    });
    expect(writes).toEqual([]);
  });

  it("moves a file to Docs Cloud and reports its doc and comments", async () => {
    const { value, imports } = context();
    expect(await ask({ kind: "file.import", path: "docs/plan.md", update: false }, value)).toEqual({
      type: "t3-docs:local-response",
      requestId: "r1",
      ok: true,
      result: {
        status: "imported",
        cloudDocId: "doc_1",
        commentsImported: 2,
        commentsSkipped: 1,
      },
    });
    expect(imports).toEqual([["docs/plan.md", false]]);
  });

  it("reports a failed import as an error, and refuses without permission", async () => {
    const failed = context({
      importResult: {
        docPath: "docs/plan.md",
        status: "failed",
        doc: null,
        error: "Docs Cloud is not connected.",
        commentsImported: 0,
        commentsSkipped: [],
      },
    });
    expect(
      await ask({ kind: "file.import", path: "docs/plan.md", update: true }, failed.value),
    ).toMatchObject({ ok: false, error: "Docs Cloud is not connected." });
    const denied = context({ canImport: false });
    expect(
      await ask({ kind: "file.import", path: "docs/plan.md", update: false }, denied.value),
    ).toMatchObject({ ok: false, error: "This connection cannot move files to Docs Cloud." });
    expect(denied.imports).toEqual([]);
  });

  it("answers a request kind it cannot parse with an error, not silence", () => {
    expect(
      unsupportedLocalDocsReply({
        type: "t3-docs:local-request",
        requestId: "r3",
        request: { kind: "file.delete", path: "docs/new.md" },
      }),
    ).toEqual({
      type: "t3-docs:local-response",
      requestId: "r3",
      ok: false,
      error: "This version of T3 Code cannot do that.",
    });
    expect(unsupportedLocalDocsReply({ type: "t3-docs:theme" })).toBeNull();
  });

  it("answers a kind it has no handler for with an error", async () => {
    const reply = await answerLocalDocsRequest(
      { type: "t3-docs:local-request", requestId: "r2", request: { kind: "files.list" } },
      {},
      context().value,
    );
    expect(reply).toMatchObject({ requestId: "r2", ok: false });
  });
});
