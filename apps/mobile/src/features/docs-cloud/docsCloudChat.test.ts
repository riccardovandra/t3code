import { ReviewCommentContextRecord, type DocComment, type ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";

import {
  contextWithReplacedRecord,
  docsCloudCommentRecord,
  docsCloudDiagramCommentRecord,
  localDocCommentRecord,
} from "./docsCloudChat";

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

describe("diagram comments added to the chat", () => {
  it("carry the diagram, its page and the shape label, the way web does", () => {
    const record = docsCloudDiagramCommentRecord({
      diagramId: "diag-1",
      diagramTitle: "Sales flow",
      page: "Flow",
      url: "https://docs.test/diagrams/diag-1",
      commentId: "comment-9",
      quote: "Proposal",
      body: " Split this step ",
    });
    expect(isRecord(record)).toBe(true);
    expect(record).toMatchObject({
      label: "Sales flow · “Proposal”",
      sectionId: "docs-cloud-diagram:diag-1",
      filePath: "https://docs.test/diagrams/diag-1",
      text: "Split this step",
      diff: "Proposal",
      docsCloudDiagram: { diagramId: "diag-1", commentId: "comment-9", page: "Flow" },
    });
    expect(record).not.toHaveProperty("docsCloud");
  });
});

describe("a reply to a thread already in the draft", () => {
  const comment = docsCloudDiagramCommentRecord({
    diagramId: "diag-1",
    diagramTitle: "Sales flow",
    page: null,
    url: "https://docs.test/diagrams/diag-1",
    commentId: "comment-9",
    quote: "Proposal",
    body: "Split this step",
  });
  const reply = docsCloudDiagramCommentRecord({
    diagramId: "diag-1",
    diagramTitle: "Sales flow",
    page: null,
    url: "https://docs.test/diagrams/diag-1",
    commentId: "comment-9",
    quote: "Proposal",
    body: "And rename it",
  });

  it("updates the one chip instead of adding a second reference", () => {
    const text = `Please handle ${formatComposerContextReference(comment)} `;
    const context = contextWithReplacedRecord(
      { text, context: { version: 1, records: [comment] } },
      reply,
    );
    expect(context?.records).toEqual([reply]);
  });

  it("leaves a draft without the thread to the usual insert", () => {
    expect(contextWithReplacedRecord({ text: "Hello", context: undefined }, reply)).toBeNull();
    // A record left over with no reference in the text is not a chip.
    expect(
      contextWithReplacedRecord(
        { text: "Hello", context: { version: 1, records: [comment] } },
        reply,
      ),
    ).toBeNull();
  });
});
