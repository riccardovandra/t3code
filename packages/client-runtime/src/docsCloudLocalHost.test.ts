import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { localDocVersion, type LocalRequestMessage } from "@t3tools/shared/docsCloudLocal";
import { describe, expect, it } from "vite-plus/test";

import {
  answerLocalDocsRequest,
  LOCAL_FILE_HANDLERS,
  type LocalDocsContext,
  unsupportedLocalDocsReply,
} from "./docsCloudLocalHost.ts";

function context(options: { canWrite?: boolean; truncated?: boolean } = {}) {
  const disk = new Map([["docs/plan.md", "# Plan\n"]]);
  const writes: Array<[string, string]> = [];
  const value: LocalDocsContext = {
    environmentId: "env-1" as EnvironmentId,
    projectId: "project-1" as ProjectId,
    cwd: "/repo",
    canWrite: options.canWrite ?? true,
    files: {
      list: async () => [...disk.keys()].map((path) => ({ path, title: "Plan" })),
      read: async (path) => {
        const contents = disk.get(path);
        if (contents === undefined) throw new Error(`No such file: ${path}`);
        return { contents, truncated: options.truncated ?? false };
      },
      write: async (path, contents) => {
        writes.push([path, contents]);
        disk.set(path, contents);
      },
    },
  };
  return { value, disk, writes };
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

  it("answers a request kind it cannot parse with an error, not silence", () => {
    expect(
      unsupportedLocalDocsReply({
        type: "t3-docs:local-request",
        requestId: "r3",
        request: { kind: "file.import", path: "docs/new.md" },
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
