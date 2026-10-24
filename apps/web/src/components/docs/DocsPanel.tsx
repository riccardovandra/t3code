import { useAtomValue } from "@effect/atom-react";
import {
  AuthFilesystemWriteScope,
  type DocComment,
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  ArrowLeftIcon,
  CheckCheckIcon,
  CloudIcon,
  DownloadIcon,
  FileTextIcon,
  FolderIcon,
  MessageSquareIcon,
  MoveHorizontalIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { useQuietThreadShell } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  setProjectFileQueryData,
  useProjectEntriesQuery,
  useProjectFileQuery,
} from "../files/projectFilesQueryState";
import { useFileSaveCoordinator } from "../files/useFileSaveCoordinator";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { RefreshIcon } from "../ui/refresh-icon";
import type { DocAnchor } from "./docAnchors";
import { DocCommentComposerCard, DocCommentThreadCard } from "./DocCommentCard";
import { COMMENT_CARD_GAP, layoutCommentCards } from "./docCommentLayout";
import { DocEditor } from "./DocEditor";
import {
  DocsCloudDocActions,
  DocsCloudImportAll,
  type DocsCloudTarget,
  useDocsCloudImports,
} from "./DocsCloudImport";
import {
  DOCS_ROOT,
  docTitleFromPath,
  isMarkdownPath,
  nextDocPath,
  unsupportedMarkdownReason,
} from "@t3tools/shared/docPaths";

const DRAFT_COMMENT_ID = "draft";
/** Below this panel width comments collapse to margin icons, as Claude Docs does in a narrow pane. */
const SIDE_BY_SIDE_MIN_WIDTH = 760;

interface DocsPanelProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly threadRef: ScopedThreadRef;
  readonly docPath: string | undefined;
  readonly onSelectDoc: (docPath: string | undefined) => void;
  readonly docsCloud: DocsCloudTarget | null;
}

export function DocsPanel(props: DocsPanelProps) {
  return (
    <section aria-label="Docs" className="@container flex min-h-0 min-w-0 flex-1 flex-col">
      {props.docPath ? (
        <DocView key={props.docPath} {...props} docPath={props.docPath} />
      ) : (
        <DocsList {...props} />
      )}
    </section>
  );
}

/** Changes whenever the thread's latest run finishes, so agent edits show up without a manual refresh. */
function useLatestRunCompletion(threadRef: ScopedThreadRef): string | null {
  const latestRun = useQuietThreadShell(threadRef)?.latestRun ?? null;
  return latestRun?.completedAt ? `${latestRun.runId}:${latestRun.completedAt}` : null;
}

function useRefreshOnRunCompletion(threadRef: ScopedThreadRef, refresh: () => void) {
  const completion = useLatestRunCompletion(threadRef);
  const stableRefresh = useStableCallback(refresh);
  const seen = useRef(completion);
  useEffect(() => {
    if (completion === seen.current) return;
    seen.current = completion;
    stableRefresh();
  }, [completion, stableRefresh]);
}

/** Doc agent sub-threads edit the doc too, so their finished turns refresh it as well. */
function RefreshOnRunCompletion(props: {
  readonly threadRef: ScopedThreadRef;
  readonly refresh: () => void;
}) {
  useRefreshOnRunCompletion(props.threadRef, props.refresh);
  return null;
}

function DocsList({
  environmentId,
  projectId,
  cwd,
  threadRef,
  onSelectDoc,
  docsCloud,
}: DocsPanelProps) {
  const [folder, setFolder] = useState(DOCS_ROOT);
  const [filter, setFilter] = useState("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const entries = useProjectEntriesQuery(environmentId, cwd, folder);
  useRefreshOnRunCompletion(threadRef, entries.refresh);
  const canWrite = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const writeFile = useAtomCommand(projectEnvironment.writeFile, "create doc");
  const { imports } = useDocsCloudImports({ environmentId, projectId, cwd }, docsCloud !== null);

  const visible = (entries.data?.entries ?? [])
    .filter((entry) => !entry.ignored && (entry.kind === "directory" || isMarkdownPath(entry.path)))
    .filter((entry) => entry.path.toLowerCase().includes(filter.trim().toLowerCase()))
    .toSorted((a, b) =>
      a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "directory" ? -1 : 1,
    );

  const create = async () => {
    const trimmed = title.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    const existing = new Set(
      (entries.data?.entries ?? []).map((entry) => entry.path.toLowerCase()),
    );
    const path = nextDocPath(folder, trimmed, existing);
    const result = await writeFile({
      environmentId,
      input: { cwd, relativePath: path, contents: `# ${trimmed}\n` },
    });
    setCreating(false);
    if (result._tag !== "Success") return;
    setTitle("");
    entries.refresh();
    onSelectDoc(path);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        {folder !== DOCS_ROOT ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Up one folder"
            onClick={() => setFolder(folder.slice(0, folder.lastIndexOf("/")) || DOCS_ROOT)}
          >
            <ArrowLeftIcon />
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {folder}/
        </span>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Refresh docs"
          onClick={entries.refresh}
        >
          <RefreshIcon />
        </Button>
      </div>
      <form
        className="flex gap-2 border-b border-border px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Input
          size="sm"
          value={title}
          placeholder={canWrite ? "New doc title" : "This connection cannot create docs"}
          disabled={!canWrite}
          aria-label="New doc title"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button size="sm" type="submit" disabled={!canWrite || !title.trim() || creating}>
          Create
        </Button>
      </form>
      {docsCloud ? <DocsCloudImportAll scope={{ environmentId, projectId, cwd }} /> : null}
      <div className="px-3 pt-2">
        <Input
          size="sm"
          value={filter}
          placeholder="Filter docs"
          aria-label="Filter docs"
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {visible.map((entry) => (
          <li key={entry.path}>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() =>
                entry.kind === "directory" ? setFolder(entry.path) : onSelectDoc(entry.path)
              }
            >
              {entry.kind === "directory" ? <FolderIcon /> : <FileTextIcon />}
              <span className="truncate">
                {entry.kind === "directory"
                  ? entry.path.slice(entry.path.lastIndexOf("/") + 1)
                  : docTitleFromPath(entry.path)}
              </span>
              {imports.has(entry.path) ? (
                <CloudIcon aria-label="Imported to Docs Cloud" className="ml-auto opacity-60" />
              ) : null}
            </Button>
          </li>
        ))}
        {!entries.isPending && visible.length === 0 ? (
          <li className="px-2 py-6 text-center text-xs text-muted-foreground">
            {filter.trim()
              ? "No docs match this filter."
              : `No docs in ${folder}/ yet. Create one above, or ask the agent to write one.`}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function DocView({
  environmentId,
  projectId,
  cwd,
  threadRef,
  docPath,
  onSelectDoc,
  docsCloud,
}: DocsPanelProps & { readonly docPath: string }) {
  const file = useProjectFileQuery(environmentId, cwd, docPath);
  const commentsQuery = useEnvironmentQuery(
    serverEnvironment.docComments({ environmentId, input: { projectId, docPath } }),
  );
  const refreshAll = () => {
    file.refresh();
    commentsQuery.refresh();
  };
  useRefreshOnRunCompletion(threadRef, refreshAll);
  const agentThreadIds = [
    ...new Set(
      (commentsQuery.data?.comments ?? []).flatMap((comment) =>
        [comment, ...comment.replies].flatMap((message) =>
          message.sentToThreadId ? [message.sentToThreadId] : [],
        ),
      ),
    ),
  ];

  const canWrite = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const canComment = useAtomValue(serverEnvironment.createDocComment.permissionAtom(environmentId));
  const [saving, setSaving] = useState(false);
  const onPendingChange = useStableCallback((_path: string, pending: boolean) =>
    setSaving(pending),
  );
  const saveCoordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath: docPath,
    onPendingChange,
  });

  const [selection, setSelection] = useState<DocAnchor | null>(null);
  const [draftAnchor, setDraftAnchor] = useState<DocAnchor | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [wide, setWide] = useLocalStorage("t3code:docs:wide", false, Schema.Boolean);
  const [anchorTops, setAnchorTops] = useState<ReadonlyMap<string, number> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setNarrow(root.clientWidth < SIDE_BY_SIDE_MIN_WIDTH);
    measure();
    return observeResize(root, measure);
  }, []);

  const comments = commentsQuery.data?.comments ?? [];
  const openComments = comments.filter((comment) => comment.resolvedAt === null);
  const resolvedComments = comments.filter((comment) => comment.resolvedAt !== null);
  const editorComments = [
    ...openComments,
    ...(draftAnchor ? [{ id: DRAFT_COMMENT_ID, ...draftAnchor }] : []),
  ];
  const markdown = file.data?.contents ?? null;
  const unsupported = markdown === null ? null : unsupportedMarkdownReason(markdown);
  const readOnlyReason = !canWrite
    ? "This connection cannot edit files."
    : file.data?.truncated
      ? "This doc is too large to edit here."
      : unsupported
        ? `This doc uses ${unsupported}, which the editor cannot preserve. You can still comment, or ask the agent to edit it.`
        : null;

  const target = { environmentId, projectId, docPath, threadId: threadRef.threadId };
  const startComment = () => {
    if (!selection || !canComment) return;
    setDraftAnchor(selection);
    setActiveCommentId(DRAFT_COMMENT_ID);
    setShowResolved(false);
  };
  const closeDraft = (created: DocComment | null) => {
    setDraftAnchor(null);
    setActiveCommentId(created?.id ?? null);
    if (created) commentsQuery.refresh();
  };

  const threadCard = (comment: DocComment, detached: boolean) => (
    <DocCommentThreadCard
      {...target}
      comment={comment}
      detached={detached}
      active={comment.id === activeCommentId}
      onActivate={() => setActiveCommentId(comment.id)}
      onDeactivate={() => setActiveCommentId(null)}
      onChanged={commentsQuery.refresh}
    />
  );
  const draftCard = draftAnchor ? (
    <DocCommentComposerCard {...target} anchor={draftAnchor} onDone={closeDraft} />
  ) : null;
  const anchored = [
    ...openComments.flatMap((comment) => {
      const anchorTop = anchorTops?.get(comment.id);
      return anchorTop === undefined
        ? []
        : [{ id: comment.id, anchorTop, card: threadCard(comment, false) }];
    }),
    ...(draftCard && anchorTops?.has(DRAFT_COMMENT_ID)
      ? [{ id: DRAFT_COMMENT_ID, anchorTop: anchorTops.get(DRAFT_COMMENT_ID)!, card: draftCard }]
      : []),
  ];
  const detached =
    anchorTops === null ? [] : openComments.filter((comment) => !anchorTops.has(comment.id));

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {agentThreadIds.map((threadId) => (
        <RefreshOnRunCompletion
          key={threadId}
          threadRef={{ environmentId, threadId }}
          refresh={refreshAll}
        />
      ))}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="All docs"
          onClick={() => onSelectDoc(undefined)}
        >
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {docTitleFromPath(docPath)}
        </span>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saving ? "Saving…" : null}
        </span>
        {docsCloud ? (
          <DocsCloudDocActions
            scope={{ environmentId, projectId, cwd }}
            docPath={docPath}
            target={docsCloud}
          />
        ) : null}
        {resolvedComments.length > 0 ? (
          <Button
            size="xs"
            variant={showResolved ? "secondary" : "ghost-muted"}
            aria-pressed={showResolved}
            onClick={() => setShowResolved(!showResolved)}
          >
            <CheckCheckIcon />
            Resolved ({resolvedComments.length})
          </Button>
        ) : null}
        <Button
          size="icon-xs"
          variant={wide ? "secondary" : "ghost-muted"}
          aria-label="Wide page"
          aria-pressed={wide}
          onClick={() => setWide(!wide)}
        >
          <MoveHorizontalIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Download as Markdown"
          disabled={markdown === null}
          onClick={() => markdown !== null && downloadMarkdown(docPath, markdown)}
        >
          <DownloadIcon />
        </Button>
        <Button size="icon-xs" variant="ghost-muted" aria-label="Refresh doc" onClick={refreshAll}>
          <RefreshIcon />
        </Button>
      </div>
      {readOnlyReason && markdown !== null ? (
        <p className="border-b border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
          {readOnlyReason}
        </p>
      ) : null}
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "relative mx-auto flex w-full items-start gap-6 px-6 pt-10 pb-24",
            wide ? "max-w-[1400px]" : "max-w-[1080px]",
          )}
        >
          <div className={cn("min-w-0 flex-1", !wide && "max-w-[720px]")}>
            {markdown !== null ? (
              <DocEditor
                markdown={markdown}
                editable={readOnlyReason === null}
                canComment={canComment}
                showToolbar={draftAnchor === null}
                comments={editorComments}
                activeCommentId={activeCommentId}
                onChange={(next) => {
                  setProjectFileQueryData(environmentId, cwd, docPath, next);
                  saveCoordinator.change(next);
                }}
                onSelectionAnchor={setSelection}
                onCommentClick={(id) => {
                  if (id !== null) setShowResolved(false);
                  setActiveCommentId((current) =>
                    id === null && current === DRAFT_COMMENT_ID ? current : id,
                  );
                }}
                onCommentShortcut={startComment}
                onAnchorTops={setAnchorTops}
              />
            ) : file.error ? (
              <div className="flex flex-col items-start gap-2 py-10">
                <p className="text-sm font-medium">This doc can't be opened</p>
                <p className="text-sm text-muted-foreground">
                  It may have been renamed, moved or deleted, or it isn't in this thread's checkout.
                </p>
                <p className="font-mono text-xs text-muted-foreground">{file.error}</p>
                <Button size="sm" variant="outline" onClick={() => onSelectDoc(undefined)}>
                  All docs
                </Button>
              </div>
            ) : null}
          </div>
          {showResolved ? (
            <aside
              aria-label="Resolved comments"
              className={cn(
                "flex w-72 shrink-0 flex-col gap-2",
                narrow && "absolute top-4 right-4 z-30 max-h-[70vh] overflow-y-auto",
              )}
            >
              {resolvedComments.map((comment) => (
                <div key={comment.id}>{threadCard(comment, false)}</div>
              ))}
            </aside>
          ) : narrow ? (
            <CommentGutter
              anchored={anchored}
              activeId={activeCommentId}
              onActivate={setActiveCommentId}
            />
          ) : (
            <CommentMargin
              anchored={anchored}
              activeId={activeCommentId}
              trailing={detached.map((comment) => (
                <div key={comment.id}>{threadCard(comment, true)}</div>
              ))}
            />
          )}
        </div>
        {narrow && detached.length > 0 && !showResolved ? (
          <div className="mx-auto flex max-w-[720px] flex-col gap-2 px-6 pb-10">
            {detached.map((comment) => (
              <div key={comment.id}>{threadCard(comment, true)}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface AnchoredCard {
  readonly id: string;
  readonly anchorTop: number;
  readonly card: React.ReactNode;
}

/** Cards beside their quotes in the right margin, pushed apart where they would overlap. */
function CommentMargin(props: {
  readonly anchored: ReadonlyArray<AnchoredCard>;
  readonly activeId: string | null;
  readonly trailing: ReadonlyArray<React.ReactNode>;
}) {
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const onHeight = useStableCallback((id: string, height: number) =>
    setHeights((current) =>
      current.get(id) === height ? current : new Map(current).set(id, height),
    ),
  );
  const tops = layoutCommentCards(
    props.anchored.map((item) => ({
      id: item.id,
      anchorTop: item.anchorTop,
      height: heights.get(item.id) ?? 0,
    })),
    props.activeId,
  );
  const bottom = Math.max(
    0,
    ...props.anchored.map((item) => (tops.get(item.id) ?? 0) + (heights.get(item.id) ?? 0)),
  );
  return (
    <aside aria-label="Comments" className="relative w-72 shrink-0">
      <div className="relative" style={{ height: bottom }}>
        {props.anchored.map((item) => (
          <MarginCard
            key={item.id}
            id={item.id}
            top={tops.get(item.id) ?? item.anchorTop}
            active={item.id === props.activeId}
            onHeight={onHeight}
          >
            {item.card}
          </MarginCard>
        ))}
      </div>
      {props.trailing.length > 0 ? (
        <div className="flex flex-col gap-2" style={{ marginTop: COMMENT_CARD_GAP * 2 }}>
          {props.trailing}
        </div>
      ) : null}
    </aside>
  );
}

function MarginCard(props: {
  readonly id: string;
  readonly top: number;
  readonly active: boolean;
  readonly onHeight: (id: string, height: number) => void;
  readonly children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { id, onHeight } = props;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // The observer reports the card's first size, then every change.
    return observeResize(element, () => onHeight(id, element.offsetHeight));
  }, [id, onHeight]);
  return (
    <div
      ref={ref}
      className={cn(
        "absolute inset-x-0 transition-[top,translate] duration-150",
        props.active && "z-10 -translate-x-3",
      )}
      style={{ top: props.top }}
    >
      {props.children}
    </div>
  );
}

/** Narrow panes show an icon per comment beside its line; the open one floats over the text. */
function CommentGutter(props: {
  readonly anchored: ReadonlyArray<AnchoredCard>;
  readonly activeId: string | null;
  readonly onActivate: (id: string) => void;
}) {
  const active = props.anchored.find((item) => item.id === props.activeId);
  return (
    <aside aria-label="Comments" className="relative w-6 shrink-0 self-stretch">
      {props.anchored.map((item) =>
        item.id === "draft" ? null : (
          <Button
            key={item.id}
            size="icon-xs"
            variant={item.id === props.activeId ? "secondary" : "ghost-muted"}
            aria-label="Open comment"
            className="absolute right-0"
            style={{ top: item.anchorTop }}
            onClick={() => props.onActivate(item.id)}
          >
            <MessageSquareIcon />
          </Button>
        ),
      )}
      {active ? (
        <div className="absolute right-0 z-30 w-72" style={{ top: active.anchorTop + 28 }}>
          {active.card}
        </div>
      ) : null}
    </aside>
  );
}

function downloadMarkdown(docPath: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = docPath.slice(docPath.lastIndexOf("/") + 1);
  link.click();
  URL.revokeObjectURL(url);
}
