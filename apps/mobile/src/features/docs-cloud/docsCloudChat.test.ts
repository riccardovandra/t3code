import { ReviewCommentContextRecord, type DocComment, type ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { docsCloudCommentRecord, localDocCommentRecord } from "./docsCloudChat";

const isRecord = Schema.is(ReviewCommentContextRecord);

const thread: DocComment = {
  id: "c1",
  projectId: "project-1" as ProjectId,
  docPath: "docs/plan.md",
  quote: "ships Friday",
  prefix: "",
  suffix: "",
  author: { kind: "user", threadId: null },
  body: "  Can we make it Thursday?  ",
  createdAt: "2026-10-20T10:00:00.000Z",
  resolvedAt: null,
  sentToThreadId: null,
  replies: [],
};

describe("doc comments added to the chat", () => {
  it("carry a project file comment the way web does, so the agent can answer it", () => {
    const record = localDocCommentRecord("docs/plan.md", thread);
    expect(isRecord(record)).toBe(true);
    expect(record).toMatchObject({
      filePath: "docs/plan.md",
      sectionTitle: "Doc comment c1 (reply with docs_comment_reply)",
      text: "Can we make it Thursday?",
      diff: "ships Friday",
      label: "docs/plan.md · “ships Friday”",
    });
  });

  it("carry a Docs Cloud comment with its doc, tab and cell anchor", () => {
    const record = docsCloudCommentRecord({
      docId: "doc-1",
      tabId: "tab-1",
      docTitle: "Launch plan",
      url: "https://docs.example.com/d/doc-1/tab-1",
      commentId: "k1",
      quote: "",
      body: "Fix this cell",
      anchor: { kind: "cell", blockId: "t1", rowId: "r1", colId: "c1" },
    });
    expect(isRecord(record)).toBe(true);
    expect(record.docsCloud).toEqual({
      docId: "doc-1",
      tabId: "tab-1",
      docTitle: "Launch plan",
      url: "https://docs.example.com/d/doc-1/tab-1",
      commentId: "k1",
      anchor: { kind: "cell", blockId: "t1", rowId: "r1", colId: "c1" },
    });
    expect(record.label).toBe("Launch plan");
  });
});
