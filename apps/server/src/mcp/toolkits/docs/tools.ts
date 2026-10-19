import {
  DocComment,
  DocCommentId,
  DocCommentMutationResult,
  DocPath,
  NonNegativeInt,
  OrchestratorMcpFailure,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as DocCommentsService from "../../../docs/DocCommentsService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as WorkspaceDocs from "../../../workspace/WorkspaceDocs.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    DocCommentsService.DocCommentsService,
    ProjectService.ProjectService,
    WorkspaceDocs.WorkspaceDocs,
  ],
};

const Body = TrimmedNonEmptyString.check(Schema.isMaxLength(10_000));

const DocPathParameter = DocPath.annotate({
  description: "Project-relative path of the markdown file, such as docs/plan.md.",
});

const Folder = TrimmedNonEmptyString.check(Schema.isMaxLength(512)).annotate({
  description: 'Project-relative folder. Defaults to "docs".',
});

const DocSummary = Schema.Struct({ docPath: DocPath, title: Schema.String });
// The conversation card shows this preview without reading the file.
const OpenedDoc = Schema.Struct({ ...DocSummary.fields, excerpt: Schema.String });

const DocsListTool = Tool.make("docs_list", {
  ...shared,
  description:
    "List this project's docs: markdown (.md) files under a folder, searched recursively and sorted by path, with each doc's count of open review comments. Docs live in the calling thread's checkout.",
  parameters: Schema.Struct({ folder: Schema.optional(Folder) }),
  success: Schema.Struct({
    docs: Schema.Array(Schema.Struct({ ...DocSummary.fields, openComments: NonNegativeInt })),
    truncated: Schema.Boolean,
  }),
})
  .annotate(Tool.Title, "List docs")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const DocsReadTool = Tool.make("docs_read", {
  ...shared,
  description:
    "Read a project doc's markdown together with its open review comments in one call. To change the doc, edit the file with your file tools.",
  parameters: Schema.Struct({ docPath: DocPathParameter }),
  success: Schema.Struct({
    ...DocSummary.fields,
    markdown: Schema.String,
    truncated: Schema.Boolean,
    message: Schema.optional(Schema.String),
    comments: Schema.Array(DocComment),
  }),
})
  .annotate(Tool.Title, "Read a doc")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const DocsCreateTool = Tool.make("docs_create", {
  ...shared,
  description:
    "Create a markdown doc in the project and open it in the user's Docs panel, where they can read, edit and comment on it. Use this when the user asks for a document, plan, spec, report or notes to keep, instead of pasting it into chat. The file is named after the title and never overwrites an existing doc. Without markdown, the doc starts as just its title heading.",
  parameters: Schema.Struct({
    title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
    markdown: Schema.optional(
      Schema.String.check(Schema.isMaxLength(1_000_000)).annotate({
        description: "The doc's full markdown, usually starting with a `# Title` heading.",
      }),
    ),
    folder: Schema.optional(Folder),
  }),
  success: Schema.Struct({ doc: OpenedDoc }),
})
  .annotate(Tool.Title, "Create a doc")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const DocsOpenTool = Tool.make("docs_open", {
  ...shared,
  description:
    "Show an existing project doc in the user's Docs panel, for example after updating it or to point them at it.",
  parameters: Schema.Struct({ docPath: DocPathParameter }),
  success: Schema.Struct({ doc: OpenedDoc }),
})
  .annotate(Tool.Title, "Open a doc")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const DocsListCommentsTool = Tool.make("docs_list_comments", {
  ...shared,
  description:
    "List review comments on this project's docs. Docs are markdown (.md) files in the project; the user reads and comments on them in T3 Code. Each comment anchors to `quote`, a passage of the doc's text, with `prefix`/`suffix` as surrounding context, and carries a reply thread. To address a comment, edit the markdown file itself with your file tools, then reply with docs_comment_reply saying what changed. Resolve with docs_comment_resolve only when the user asks or the thread is your own. Omit docPath to list every doc in the project. Resolved comments are hidden unless includeResolved is true.",
  parameters: Schema.Struct({
    docPath: Schema.optional(
      DocPath.annotate({
        description: "Project-relative path of the markdown file, such as docs/plan.md.",
      }),
    ),
    includeResolved: Schema.optional(
      Schema.Boolean.annotate({ description: "Include resolved comments. Defaults to false." }),
    ),
  }),
  success: Schema.Struct({ comments: Schema.Array(DocComment) }),
})
  .annotate(Tool.Title, "List doc comments")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const DocsCommentCreateTool = Tool.make("docs_comment_create", {
  ...shared,
  description:
    "Leave a review comment on a project doc (a markdown file), anchored to a passage of its text. `quote` must match the doc's text as it reads, without markdown syntax such as `**`, `#` or link URLs, so the comment can find its place; keep it short, distinctive and within one paragraph.",
  parameters: Schema.Struct({
    docPath: DocPath.annotate({
      description: "Project-relative path of the markdown file, such as docs/plan.md.",
    }),
    quote: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)).annotate({
      description: "The doc text the comment refers to, as it reads without markdown syntax.",
    }),
    body: Body,
  }),
  success: DocCommentMutationResult,
})
  .annotate(Tool.Title, "Comment on a doc")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const DocsCommentReplyTool = Tool.make("docs_comment_reply", {
  ...shared,
  description:
    "Reply to a doc comment thread, for example to say how you addressed it. Replying to a reply adds to the same thread.",
  parameters: Schema.Struct({ commentId: DocCommentId, body: Body }),
  success: DocCommentMutationResult,
})
  .annotate(Tool.Title, "Reply to a doc comment")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const DocsCommentResolveTool = Tool.make("docs_comment_resolve", {
  ...shared,
  description:
    "Resolve a doc comment thread once it is addressed, or reopen it with resolved=false.",
  parameters: Schema.Struct({
    commentId: DocCommentId,
    resolved: Schema.optional(
      Schema.Boolean.annotate({ description: "false reopens the thread. Defaults to true." }),
    ),
  }),
  success: DocCommentMutationResult,
})
  .annotate(Tool.Title, "Resolve a doc comment")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const DocsToolkit = Toolkit.make(
  DocsListTool,
  DocsReadTool,
  DocsCreateTool,
  DocsOpenTool,
  DocsListCommentsTool,
  DocsCommentCreateTool,
  DocsCommentReplyTool,
  DocsCommentResolveTool,
);
