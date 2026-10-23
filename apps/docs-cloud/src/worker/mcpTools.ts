// The agent tools behind `/mcp`. Reads go through `docs.ts`; every write to an
// existing doc goes through `deps.rooms` so open editors receive it live.

import { findQuote, markdownToText } from "../shared/anchors.ts";
import {
  DOC_STATUSES,
  type Comment,
  type DocStatus,
  type DocSummary,
  type Tab,
} from "../shared/protocol.ts";
import { groupThreads } from "../shared/threads.ts";
import { describeWidgetProblems } from "../shared/widget/check.ts";
import { findWidgetFences, spliceFenceSource } from "../shared/widget/fence.ts";
import { MAX_LABEL_LENGTH, rewriteLabel } from "../shared/widget/rewrite.ts";
import { analyzeWidget, formatDiagnostic } from "../shared/widget/validate.ts";
import type { ApiDeps } from "./api.ts";
import * as Comments from "./comments.ts";
import * as DocThreads from "./docThreads.ts";
import * as Docs from "./docs.ts";
import { widgetProblems } from "./widgets.ts";

const MAX_MARKDOWN_LENGTH = 1_000_000;
/** edit_tab re-applies against the latest version this many times before giving up. */
const EDIT_ATTEMPTS = 5;

export class McpToolError extends Error {
  readonly detail: Record<string, unknown>;
  readonly unknownTool: boolean;

  constructor(detail: Record<string, unknown>, unknownTool = false) {
    super(typeof detail.error === "string" ? detail.error : "tool_error");
    this.detail = detail;
    this.unknownTool = unknownTool;
  }
}

function fail(error: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new McpToolError({ error, message, ...extra });
}

interface ToolContext {
  readonly deps: ApiDeps;
  readonly origin: string;
  /** The MCP client's name from `initialize`, else the token's name. */
  readonly agentName: string;
}

type Args = Record<string, unknown>;

function requireString(args: Args, key: string, max = 200): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    return fail("invalid_argument", `"${key}" must be a non-empty string up to ${max} characters.`);
  }
  return value.trim();
}

function optionalString(args: Args, key: string, max = 200): string | undefined {
  return args[key] === undefined || args[key] === null ? undefined : requireString(args, key, max);
}

/** Markdown is taken verbatim, so whitespace and empty strings survive. */
function markdownArg(args: Args, key: string, required: boolean): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return required ? fail("invalid_argument", `"${key}" is required.`) : undefined;
  }
  if (typeof value !== "string") return fail("invalid_argument", `"${key}" must be a string.`);
  if (value.length > MAX_MARKDOWN_LENGTH) return fail("too_large", `"${key}" is too large.`);
  return value;
}

function requireVersion(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fail("invalid_argument", `"${key}" must be an integer tab version.`);
  }
  return value;
}

/** Refuses markdown that adds or changes an invalid diagram; nothing is written. */
function assertWidgets(markdown: string, previous?: string): void {
  const problems = widgetProblems(markdown, previous);
  if (!problems) return;
  fail(
    "widget_invalid",
    `Nothing was written: a diagram breaks the t3-widget format.\n${describeWidgetProblems(problems)}`,
    { problems },
  );
}

async function load<A>(promise: Promise<A>, what: string): Promise<A> {
  try {
    return await promise;
  } catch (cause) {
    if (cause instanceof Docs.NotFoundError) return fail("not_found", `No ${what} with that id.`);
    if (cause instanceof Docs.InvalidMoveError) {
      return fail("invalid_move", "A tab cannot move under itself or one of its own children.");
    }
    if (cause instanceof Docs.LastTabError) {
      return fail("last_tab", "A doc must keep at least one top-level tab.");
    }
    throw cause;
  }
}

const tabUrl = (ctx: ToolContext, tab: Pick<Tab, "docId" | "id">) =>
  `${ctx.origin}/d/${tab.docId}/${tab.id}`;

const tabSummary = (ctx: ToolContext, tab: Tab) => ({
  tabId: tab.id,
  title: tab.title,
  parentTabId: tab.parentTabId,
  position: tab.position,
  version: tab.version,
  url: tabUrl(ctx, tab),
});

const docSummary = (ctx: ToolContext, doc: DocSummary, firstTabId: string | undefined) => ({
  docId: doc.id,
  projectId: doc.projectId,
  title: doc.title,
  status: doc.status,
  updatedAt: new Date(doc.updatedAt).toISOString(),
  url: firstTabId ? tabUrl(ctx, { docId: doc.id, id: firstTabId }) : `${ctx.origin}/d/${doc.id}`,
});

/** Tabs in reading order: each tab followed by its children, siblings by position. */
function readingOrder(tabs: ReadonlyArray<Tab>): ReadonlyArray<{ tab: Tab; depth: number }> {
  const children = new Map<string | null, Array<Tab>>();
  for (const tab of tabs) {
    const siblings = children.get(tab.parentTabId) ?? [];
    siblings.push(tab);
    children.set(tab.parentTabId, siblings);
  }
  const ordered: Array<{ tab: Tab; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    const siblings = (children.get(parentId) ?? []).toSorted((a, b) => a.position - b.position);
    for (const tab of siblings) {
      ordered.push({ tab, depth });
      visit(tab.id, depth + 1);
    }
  };
  visit(null, 0);
  return ordered;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    count += 1;
  }
  return count;
}

const commentAuthor = (ctx: ToolContext) =>
  Comments.actorAuthor({ kind: "agent", name: ctx.agentName });

const commentSummary = (comment: Comment) => ({
  commentId: comment.id,
  author: comment.author,
  body: comment.body,
  createdAt: new Date(comment.createdAt).toISOString(),
});

async function commentWrite(
  ctx: ToolContext,
  docId: string,
  op: Comments.CommentOp,
): Promise<Comment> {
  const result = await load(ctx.deps.rooms.commentOp(docId, { op, origin: null }), "comment");
  if (result.kind === "deleted") throw new Error("unexpected comment delete");
  return result.comment;
}

/** Writes through the DocRoom, retrying a title-only change against the latest version. */
async function renameTab(ctx: ToolContext, tabId: string, title: string): Promise<Tab> {
  let tab = await load(Docs.getTab(ctx.deps.db, tabId), "tab");
  for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt += 1) {
    const result = await ctx.deps.rooms.writeTab(tab.docId, {
      tabId,
      baseVersion: tab.version,
      title,
      origin: null,
    });
    if (result.ok) return result.tab;
    tab = result.conflict;
  }
  return fail("busy", "The tab kept changing while renaming. Try again.");
}

function findDiagram(ctx: ToolContext, tab: Tab, diagramId: string) {
  const fences = findWidgetFences(tab.markdown);
  const matches = fences.filter((fence) => fence.id === diagramId);
  if (matches.length === 0) {
    fail("not_found", "No diagram with that id in this tab.", {
      diagramIds: fences.map((fence) => fence.id),
      url: tabUrl(ctx, tab),
    });
  }
  if (matches.length > 1) {
    fail("ambiguous_diagram", "Two diagrams in this tab share that id; rename one with edit_tab.");
  }
  return matches[0]!;
}

export const TOOLS = [
  {
    name: "list_projects",
    description: "List projects (each holds a library of docs) with their doc counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_project",
    description: "Create a project to organize docs.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "list_docs",
    description: "List docs, most recently updated first, optionally only one project's.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
    },
  },
  {
    name: "create_doc",
    description:
      "Create a doc in a project. Pass the skeleton (section headings with one-line placeholders) as markdown for the first tab, then share the returned url with the user before filling it in.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        markdown: { type: "string", description: "Initial markdown for the first tab." },
      },
      required: ["projectId", "title"],
    },
  },
  {
    name: "read_doc",
    description:
      "Read a doc: its tab tree (ids, versions, urls) and each tab's markdown. Pass tabId to read only that tab.",
    inputSchema: {
      type: "object",
      properties: { docId: { type: "string" }, tabId: { type: "string" } },
      required: ["docId"],
    },
  },
  {
    name: "create_tab",
    description: "Add a tab to a doc, after its siblings. Nest it with parentTabId.",
    inputSchema: {
      type: "object",
      properties: {
        docId: { type: "string" },
        title: { type: "string" },
        parentTabId: { type: "string" },
        markdown: { type: "string" },
      },
      required: ["docId", "title"],
    },
  },
  {
    name: "edit_tab",
    description:
      "Replace one exact occurrence of `find` in a tab's markdown with `replace`. The main editing tool: use it to fill sections without rewriting the tab. Fails if `find` is missing or appears more than once; include more surrounding text to make it unique.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        find: { type: "string", description: "Exact text currently in the tab." },
        replace: { type: "string" },
      },
      required: ["tabId", "find", "replace"],
    },
  },
  {
    name: "write_tab",
    description:
      "Replace a tab's whole markdown. baseVersion is the version you last read; on a conflict nothing is written and the current version is returned, so re-read and retry.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        markdown: { type: "string" },
        baseVersion: { type: "integer" },
      },
      required: ["tabId", "markdown", "baseVersion"],
    },
  },
  {
    name: "rename_tab",
    description: "Rename a tab.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "string" }, title: { type: "string" } },
      required: ["tabId", "title"],
    },
  },
  {
    name: "move_tab",
    description:
      "Move a tab under parentTabId (null for top level) at a 0-based position among its new siblings; omit position to put it last.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        parentTabId: { type: ["string", "null"] },
        position: { type: "integer", minimum: 0 },
      },
      required: ["tabId", "parentTabId"],
    },
  },
  {
    name: "delete_tab",
    description: "Delete a tab and all of its child tabs. A doc keeps at least one top-level tab.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "string" } },
      required: ["tabId"],
    },
  },
  {
    name: "set_doc_status",
    description: "Set a doc's status.",
    inputSchema: {
      type: "object",
      properties: { docId: { type: "string" }, status: { type: "string", enum: DOC_STATUSES } },
      required: ["docId", "status"],
    },
  },
  {
    name: "list_comments",
    description:
      'List comment threads on a doc (optionally one tab): the quoted passage, whether it is still in the tab ("anchored" or "text_removed"), and every reply. Resolved threads are left out unless includeResolved is true.',
    inputSchema: {
      type: "object",
      properties: {
        docId: { type: "string" },
        tabId: { type: "string" },
        includeResolved: { type: "boolean" },
      },
      required: ["docId"],
    },
  },
  {
    name: "create_comment",
    description:
      "Start a comment thread on a passage. `quote` is exact text from the tab (markdown syntax is ignored) and must appear exactly once; include more surrounding words if it repeats.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        quote: { type: "string" },
        body: { type: "string", description: "The comment, in markdown." },
      },
      required: ["tabId", "quote", "body"],
    },
  },
  {
    name: "reply_comment",
    description: "Reply in a comment thread.",
    inputSchema: {
      type: "object",
      properties: { commentId: { type: "string" }, body: { type: "string" } },
      required: ["commentId", "body"],
    },
  },
  {
    name: "resolve_comment",
    description: "Resolve a comment thread once it has been addressed.",
    inputSchema: {
      type: "object",
      properties: { commentId: { type: "string" } },
      required: ["commentId"],
    },
  },
  {
    name: "read_diagram",
    description:
      "Read one ```t3-widget diagram in a tab: its module code, title, every label's text id and words (with the anchor it sits in), its anchors, and any validation diagnostics.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "string" }, diagramId: { type: "string" } },
      required: ["tabId", "diagramId"],
    },
  },
  {
    name: "edit_diagram_label",
    description:
      "Change the words of one diagram label, found by its data-claude-text-id. Only those words change; the rest of the module stays byte-identical. The smallest way to change a diagram.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        diagramId: { type: "string" },
        textId: { type: "string" },
        value: { type: "string", description: "The label's new words, one line." },
      },
      required: ["tabId", "diagramId", "textId", "value"],
    },
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

const handlers: Record<ToolName, (args: Args, ctx: ToolContext) => Promise<object>> = {
  list_projects: async (_args, ctx) => {
    const library = await Docs.listLibrary(ctx.deps.db);
    return {
      projects: library.map((project) => ({
        projectId: project.id,
        name: project.name,
        docCount: project.docs.length,
      })),
    };
  },

  create_project: async (args, ctx) => {
    const project = await Docs.createProject(
      ctx.deps.db,
      requireString(args, "name"),
      ctx.deps.now(),
    );
    return { projectId: project.id, name: project.name };
  },

  list_docs: async (args, ctx) => {
    const projectId = optionalString(args, "projectId");
    const library = await Docs.listLibrary(ctx.deps.db);
    const projects = projectId ? library.filter((project) => project.id === projectId) : library;
    if (projectId && projects.length === 0) fail("not_found", "No project with that id.");
    const docs = projects
      .flatMap((project) => project.docs)
      .toSorted((a, b) => b.updatedAt - a.updatedAt);
    return { docs: docs.map((doc) => docSummary(ctx, doc, undefined)) };
  },

  create_doc: async (args, ctx) => {
    const projectId = requireString(args, "projectId");
    const title = requireString(args, "title");
    const markdown = markdownArg(args, "markdown", false);
    if (markdown) assertWidgets(markdown);
    const created = await load(
      Docs.createDoc(ctx.deps.db, { projectId, title, now: ctx.deps.now() }),
      "project",
    );
    let tab = created.tabs[0]!;
    if (markdown) {
      const result = await ctx.deps.rooms.writeTab(created.doc.id, {
        tabId: tab.id,
        baseVersion: tab.version,
        markdown,
        origin: null,
      });
      if (result.ok) tab = result.tab;
    }
    return { doc: docSummary(ctx, created.doc, tab.id), tab: tabSummary(ctx, tab) };
  },

  read_doc: async (args, ctx) => {
    const docId = requireString(args, "docId");
    const tabId = optionalString(args, "tabId");
    const { doc, tabs } = await load(Docs.getDoc(ctx.deps.db, docId), "doc");
    const ordered = readingOrder(tabs);
    if (tabId) {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (!tab) fail("not_found", "No tab with that id in this doc.");
      return {
        doc: docSummary(ctx, doc, ordered[0]?.tab.id),
        tab: { ...tabSummary(ctx, tab), markdown: tab.markdown },
      };
    }
    const threads = await DocThreads.listDocThreads(ctx.deps.db, docId);
    return {
      doc: docSummary(ctx, doc, ordered[0]?.tab.id),
      // T3 Code threads started from this doc ("Start work").
      startedThreads: threads.map(({ environmentId, threadId, title }) => ({
        environmentId,
        threadId,
        title,
      })),
      tabs: ordered.map(({ tab, depth }) => ({
        ...tabSummary(ctx, tab),
        depth,
        markdown: tab.markdown,
      })),
    };
  },

  create_tab: async (args, ctx) => {
    const docId = requireString(args, "docId");
    const title = requireString(args, "title");
    const parentTabId = optionalString(args, "parentTabId") ?? null;
    const markdown = markdownArg(args, "markdown", false) ?? "";
    assertWidgets(markdown);
    await load(Docs.getDoc(ctx.deps.db, docId), "doc");
    if (parentTabId !== null) {
      const parent = await load(Docs.getTab(ctx.deps.db, parentTabId), "parent tab");
      if (parent.docId !== docId) fail("not_found", "The parent tab is in another doc.");
    }
    const tab = await ctx.deps.rooms.createTab(docId, {
      parentTabId,
      title,
      markdown,
      origin: null,
    });
    return { tab: tabSummary(ctx, tab) };
  },

  edit_tab: async (args, ctx) => {
    const tabId = requireString(args, "tabId");
    const find = markdownArg(args, "find", true)!;
    const replace = markdownArg(args, "replace", true)!;
    if (find.length === 0) fail("invalid_argument", '"find" must not be empty.');
    let tab = await load(Docs.getTab(ctx.deps.db, tabId), "tab");
    for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt += 1) {
      const matches = countOccurrences(tab.markdown, find);
      if (matches === 0) {
        fail("no_match", '"find" does not appear in the tab. Re-read it with read_doc.', {
          version: tab.version,
          url: tabUrl(ctx, tab),
        });
      }
      if (matches > 1) {
        fail(
          "ambiguous_match",
          `"find" appears ${matches} times. Include more surrounding text so it matches once.`,
          { version: tab.version, url: tabUrl(ctx, tab) },
        );
      }
      const at = tab.markdown.indexOf(find);
      const markdown = tab.markdown.slice(0, at) + replace + tab.markdown.slice(at + find.length);
      if (markdown.length > MAX_MARKDOWN_LENGTH) fail("too_large", "The tab would be too large.");
      assertWidgets(markdown, tab.markdown);
      const result = await ctx.deps.rooms.writeTab(tab.docId, {
        tabId,
        baseVersion: tab.version,
        markdown,
        origin: null,
      });
      if (result.ok) return { tab: tabSummary(ctx, result.tab) };
      // Someone else wrote first; apply the same edit to their version if it still fits.
      tab = result.conflict;
    }
    return fail("busy", "The tab kept changing while editing. Re-read it and try again.", {
      version: tab.version,
    });
  },

  write_tab: async (args, ctx) => {
    const tabId = requireString(args, "tabId");
    const markdown = markdownArg(args, "markdown", true)!;
    const baseVersion = requireVersion(args, "baseVersion");
    const current = await load(Docs.getTab(ctx.deps.db, tabId), "tab");
    assertWidgets(markdown, current.markdown);
    const result = await ctx.deps.rooms.writeTab(current.docId, {
      tabId,
      baseVersion,
      markdown,
      origin: null,
    });
    if (result.ok) return { tab: tabSummary(ctx, result.tab) };
    return fail(
      "version_conflict",
      "The tab changed since you read it. Nothing was written; re-read it with read_doc and retry.",
      { currentVersion: result.conflict.version, url: tabUrl(ctx, result.conflict) },
    );
  },

  rename_tab: async (args, ctx) => {
    const tab = await renameTab(ctx, requireString(args, "tabId"), requireString(args, "title"));
    return { tab: tabSummary(ctx, tab) };
  },

  move_tab: async (args, ctx) => {
    const tabId = requireString(args, "tabId");
    const parentTabId = optionalString(args, "parentTabId") ?? null;
    const position = args.position ?? Number.MAX_SAFE_INTEGER;
    if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
      fail("invalid_argument", '"position" must be a non-negative integer.');
    }
    const current = await load(Docs.getTab(ctx.deps.db, tabId), "tab");
    await load(
      ctx.deps.rooms.moveTab(current.docId, { tabId, parentTabId, position, origin: null }),
      "parent tab in this doc",
    );
    return { tab: tabSummary(ctx, await Docs.getTab(ctx.deps.db, tabId)) };
  },

  delete_tab: async (args, ctx) => {
    const tabId = requireString(args, "tabId");
    const current = await load(Docs.getTab(ctx.deps.db, tabId), "tab");
    const deletedTabIds = await load(
      ctx.deps.rooms.deleteTab(current.docId, { tabId, origin: null }),
      "tab",
    );
    return { deletedTabIds, docUrl: `${ctx.origin}/d/${current.docId}` };
  },

  set_doc_status: async (args, ctx) => {
    const docId = requireString(args, "docId");
    const status = args.status;
    if (!DOC_STATUSES.includes(status as DocStatus)) {
      fail("invalid_argument", `"status" must be one of ${DOC_STATUSES.join(", ")}.`);
    }
    const doc = await load(
      ctx.deps.rooms.setDocStatus(docId, { status: status as DocStatus, origin: null }),
      "doc",
    );
    return { doc: docSummary(ctx, doc, undefined) };
  },

  list_comments: async (args, ctx) => {
    const docId = requireString(args, "docId");
    const tabId = optionalString(args, "tabId");
    const includeResolved = args.includeResolved === true;
    const { tabs } = await load(Docs.getDoc(ctx.deps.db, docId), "doc");
    if (tabId && !tabs.some((tab) => tab.id === tabId)) {
      fail("not_found", "No tab with that id in this doc.");
    }
    const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
    const texts = new Map<string, string>();
    const textOf = (tab: Tab) => {
      const cached = texts.get(tab.id) ?? markdownToText(tab.markdown);
      texts.set(tab.id, cached);
      return cached;
    };
    const comments = await Comments.listComments(ctx.deps.db, { docId, tabId });
    const threads = groupThreads(comments).filter(
      (thread) => includeResolved || thread.root.resolvedAt === null,
    );
    return {
      threads: threads.map(({ root, replies }) => {
        const tab = tabsById.get(root.tabId)!;
        return {
          ...commentSummary(root),
          tabId: root.tabId,
          tabUrl: tabUrl(ctx, tab),
          quote: root.quote,
          anchor: Comments.anchorStatus(root, textOf(tab)),
          resolved: root.resolvedAt !== null,
          replies: replies.map(commentSummary),
        };
      }),
    };
  },

  create_comment: async (args, ctx) => {
    const tabId = requireString(args, "tabId");
    const quote = markdownArg(args, "quote", true)!;
    if (quote.length > Comments.MAX_QUOTE_LENGTH) fail("too_large", '"quote" is too long.');
    const body = requireString(args, "body", Comments.MAX_COMMENT_LENGTH);
    const tab = await load(Docs.getTab(ctx.deps.db, tabId), "tab");
    const match = findQuote(markdownToText(tab.markdown), quote);
    if (match.kind === "missing") {
      fail("quote_not_found", '"quote" does not appear in the tab. Re-read it with read_doc.', {
        url: tabUrl(ctx, tab),
      });
    }
    if (match.kind === "ambiguous") {
      fail(
        "ambiguous_quote",
        `"quote" appears ${match.count} times. Include more surrounding text so it matches once.`,
        { url: tabUrl(ctx, tab) },
      );
    }
    const comment = await commentWrite(ctx, tab.docId, {
      kind: "create",
      tabId,
      anchor: match.anchor,
      body,
      author: commentAuthor(ctx),
    });
    return { comment: { ...commentSummary(comment), quote: comment.quote, url: tabUrl(ctx, tab) } };
  },

  reply_comment: async (args, ctx) => {
    const commentId = requireString(args, "commentId");
    const body = requireString(args, "body", Comments.MAX_COMMENT_LENGTH);
    const target = await load(Comments.getComment(ctx.deps.db, commentId), "comment");
    const reply = await commentWrite(ctx, target.docId, {
      kind: "reply",
      commentId,
      body,
      author: commentAuthor(ctx),
    });
    return { reply: { ...commentSummary(reply), threadId: reply.parentId } };
  },

  resolve_comment: async (args, ctx) => {
    const commentId = requireString(args, "commentId");
    const target = await load(Comments.getComment(ctx.deps.db, commentId), "comment");
    const root = await commentWrite(ctx, target.docId, {
      kind: "resolve",
      commentId,
      resolved: true,
    });
    return { threadId: root.id, resolved: true };
  },

  read_diagram: async (args, ctx) => {
    const tab = await load(Docs.getTab(ctx.deps.db, requireString(args, "tabId")), "tab");
    const fence = findDiagram(ctx, tab, requireString(args, "diagramId"));
    const analysis = analyzeWidget(fence.source);
    return {
      diagramId: fence.id,
      tabId: tab.id,
      version: tab.version,
      url: tabUrl(ctx, tab),
      title: analysis.title,
      viewBox: analysis.viewBox,
      code: fence.source,
      texts: analysis.labels.map((label) => ({
        textId: label.id,
        text: label.text,
        anchor: label.anchor,
      })),
      anchors: analysis.anchors,
      diagnostics: analysis.diagnostics.map(formatDiagnostic),
    };
  },

  edit_diagram_label: async (args, ctx) => {
    const tabId = requireString(args, "tabId");
    const diagramId = requireString(args, "diagramId");
    const textId = requireString(args, "textId", 64);
    const value = requireString(args, "value", MAX_LABEL_LENGTH);
    let tab = await load(Docs.getTab(ctx.deps.db, tabId), "tab");
    for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt += 1) {
      const fence = findDiagram(ctx, tab, diagramId);
      const rewrite = rewriteLabel(fence.source, textId, value);
      if (!rewrite.ok) {
        fail(rewrite.error, rewrite.message, {
          textIds: analyzeWidget(fence.source).labels.map((label) => label.id),
        });
      }
      if (rewrite.replacement === null) {
        return {
          tab: tabSummary(ctx, tab),
          diagramId,
          textId,
          previous: rewrite.previous,
          changed: false,
        };
      }
      const { start, end, text } = rewrite.replacement;
      const markdown = spliceFenceSource(tab.markdown, fence, start, end, text);
      const result = await ctx.deps.rooms.writeTab(tab.docId, {
        tabId,
        baseVersion: tab.version,
        markdown,
        origin: null,
      });
      if (result.ok) {
        return {
          tab: tabSummary(ctx, result.tab),
          diagramId,
          textId,
          previous: rewrite.previous,
          changed: true,
        };
      }
      tab = result.conflict;
    }
    return fail("busy", "The tab kept changing while editing. Re-read it and try again.", {
      version: tab.version,
    });
  },
};

export function callTool(name: string, args: Args, ctx: ToolContext): Promise<object> {
  if (!Object.hasOwn(handlers, name)) {
    throw new McpToolError({ error: "unknown_tool", message: `Unknown tool: ${name}` }, true);
  }
  return handlers[name as ToolName](args, ctx);
}
