import type { DocsCloudCommentForChat } from "@t3tools/client-runtime/docs-cloud";
import type { DocComment, ReviewCommentContextRecord } from "@t3tools/contracts";
import {
  sanitizeComposerContextLabel,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";

const QUOTE_LABEL_MAX_CHARS = 48;

/** "Title · “quote”", as the web composer labels a doc comment. */
function docCommentLabel(title: string, quote: string): string {
  const flat = quote.trim().replace(/\s+/g, " ");
  if (!flat) return sanitizeComposerContextLabel(title, "review-comment");
  const clipped =
    flat.length > QUOTE_LABEL_MAX_CHARS
      ? `${flat.slice(0, QUOTE_LABEL_MAX_CHARS - 1).trimEnd()}…`
      : flat;
  return sanitizeComposerContextLabel(`${title} · “${clipped}”`, "review-comment");
}

/**
 * A comment thread on one of the project's files as composer context, the
 * same record web's "Add to chat" makes. The agent answers it with the
 * docs_comment_* tools.
 */
export function localDocCommentRecord(
  path: string,
  thread: DocComment,
): ReviewCommentContextRecord {
  return {
    version: 1,
    kind: "review-comment",
    contextId: toKindScopedComposerContextId("review-comment", `doc-comment-${thread.id}`),
    label: docCommentLabel(path, thread.quote),
    sectionId: `doc:${path}`,
    sectionTitle: `Doc comment ${thread.id} (reply with docs_comment_reply)`,
    filePath: path,
    startIndex: 0,
    endIndex: 0,
    rangeLabel: "quoted text",
    text: thread.body.trim(),
    diff: thread.quote,
    fenceLanguage: "text",
  };
}

/** A Docs Cloud comment as composer context, as web's "Add to chat" makes it. */
export function docsCloudCommentRecord(
  comment: DocsCloudCommentForChat,
): ReviewCommentContextRecord {
  const { quote, body, anchor, ...docsCloud } = comment;
  return {
    version: 1,
    kind: "review-comment",
    contextId: toKindScopedComposerContextId("review-comment", `docs-cloud-${comment.commentId}`),
    label: docCommentLabel(comment.docTitle.trim() || "Untitled", quote),
    sectionId: `docs-cloud:${comment.docId}/${comment.tabId}`,
    sectionTitle: "Docs Cloud comment",
    filePath: comment.url,
    startIndex: 0,
    endIndex: 0,
    rangeLabel: comment.docTitle.trim() || "Untitled",
    text: body.trim(),
    diff: quote,
    fenceLanguage: "text",
    docsCloud: { ...docsCloud, ...(anchor === null ? {} : { anchor }) },
  };
}
