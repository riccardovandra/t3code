import type { Editor } from "@tiptap/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { DocAnchor } from "../../shared/anchors.ts";
import type { DocSummary, RoomMessage, Tab } from "../../shared/protocol.ts";
import { groupThreads, type CommentThread } from "../../shared/threads.ts";
import { api, ApiError, clientId } from "../api.ts";
import { CommentMargin, DRAFT_COMMENT_ID } from "../comments/CommentMargin.tsx";
import { ResolvedComments } from "../comments/ResolvedComments.tsx";
import {
  hasSendToAgentHandler,
  sendThreadToAgent,
  subscribeSendToAgent,
} from "../comments/sendToAgent.ts";
import { isCommentMessage, useComments } from "../comments/useComments.ts";
import { selectionAnchor, useEditorComments } from "../comments/useEditorComments.ts";
import { useMediaQuery } from "../comments/useMediaQuery.ts";
import { ExportMenu } from "../doc/ExportMenu.tsx";
import { OutlineRail } from "../doc/OutlineRail.tsx";
import { TabRail } from "../doc/TabRail.tsx";
import { TabSaver } from "../doc/tabSaver.ts";
import { applyPlacements, orderTabs, removeTabs } from "../doc/tabTree.ts";
import { useDocRoom } from "../doc/useDocRoom.ts";
import { TabEditor } from "../editor/TabEditor.tsx";
import { docPath, navigate } from "../router.ts";

export function DocPage(props: { readonly docId: string; readonly tabId: string | null }) {
  const [doc, setDoc] = useState<DocSummary | null>(null);
  const [tabs, setTabs] = useState<ReadonlyMap<string, Tab>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const saver = useRef<TabSaver | null>(null);
  // Bumped when the active tab's content changes underneath the editor.
  const [revision, setRevision] = useState(0);

  const upsertTab = useCallback((tab: Tab) => {
    setTabs((current) => {
      const existing = current.get(tab.id);
      if (existing && existing.version > tab.version) return current;
      return new Map(current).set(tab.id, tab);
    });
  }, []);

  const comments = useComments(props.docId);
  const loadComments = comments.load;
  const load = useCallback(async () => {
    const [loaded] = await Promise.all([api.doc(props.docId), loadComments()]);
    setDoc(loaded.doc);
    setTabs(new Map(loaded.tabs.map((tab) => [tab.id, tab])));
  }, [props.docId, loadComments]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabList = [...tabs.values()];
  const activeTab =
    (props.tabId ? tabs.get(props.tabId) : undefined) ?? orderTabs(tabList)[0]?.tab ?? null;
  const activeTabId = activeTab?.id ?? null;

  // The URL follows the active tab, including after it is deleted elsewhere.
  useEffect(() => {
    if (activeTabId && props.tabId !== activeTabId) {
      navigate(docPath(props.docId, activeTabId), { replace: true });
    }
  }, [activeTabId, props.docId, props.tabId]);

  const tabsRef = useRef(tabs);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
  });

  // One saver per active tab; leaving a tab flushes its pending edit.
  useEffect(() => {
    const current = activeTabId ? tabsRef.current.get(activeTabId) : undefined;
    if (!current) return;
    const tabSaver = new TabSaver(current.id, current.version, {
      onSaved: upsertTab,
      onConflict: (tab) => {
        upsertTab(tab);
        setRevision((value) => value + 1);
        setNotice(
          "This tab was changed elsewhere, so it was reloaded. Your last edit was not saved.",
        );
      },
    });
    saver.current = tabSaver;
    return () => {
      void tabSaver.flush();
      if (saver.current === tabSaver) saver.current = null;
    };
  }, [activeTabId, upsertTab]);

  useEffect(() => {
    const flush = () => void saver.current?.flush();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  useDocRoom(props.docId, {
    onMessage: (message: RoomMessage) => {
      if (isCommentMessage(message)) {
        comments.apply(message);
        return;
      }
      if (message.type === "doc.updated") {
        setDoc(message.doc);
        return;
      }
      if (message.type === "tab.created") {
        upsertTab(message.tab);
        return;
      }
      // Moves and deletes are idempotent, so our own echoes are applied too.
      if (message.type === "tab.moved") {
        setTabs((current) => applyPlacements(current, message.placements));
        return;
      }
      if (message.type === "tab.deleted") {
        setTabs((current) =>
          applyPlacements(removeTabs(current, message.tabIds), message.placements),
        );
        return;
      }
      const tab = message.tab;
      if (message.origin === clientId) return;
      const tabSaver = saver.current;
      if (tab.id === activeTabId && tabSaver) {
        // With an unsaved local edit, the next save conflicts and reloads instead.
        if (tabSaver.dirty) return;
        tabSaver.acceptRemote(tab);
        setRevision((value) => value + 1);
      }
      upsertTab(tab);
    },
    onReconnect: () => void load(),
  });

  const report = (action: string) => (cause: unknown) => {
    const code = cause instanceof ApiError ? cause.body.error : undefined;
    setNotice(
      code === "last_tab"
        ? "A doc needs at least one top-level tab."
        : `Could not ${action} the tab. Reload and try again.`,
    );
  };

  const createTab = async (parentTabId: string | null) => {
    const { tab } = await api.createTab(props.docId, { title: "Untitled tab", parentTabId });
    upsertTab(tab);
    navigate(docPath(props.docId, tab.id));
  };

  const renameTab = async (tabId: string, title: string) => {
    const tabSaver = tabId === activeTabId ? saver.current : null;
    // Land pending edits first so the title write does not race the body save.
    await tabSaver?.flush();
    const write = (baseVersion: number) => api.writeTab(tabId, { baseVersion, title });
    let saved: Tab;
    try {
      saved = (await write(tabsRef.current.get(tabId)?.version ?? 1)).tab;
    } catch (cause) {
      // A title-only write is safe to reapply on top of a newer version.
      if (!(cause instanceof ApiError && cause.status === 409 && cause.body.tab)) throw cause;
      saved = (await write(cause.body.tab.version)).tab;
    }
    tabSaver?.acceptRemote(saved);
    upsertTab(saved);
  };

  const moveTab = async (tabId: string, parentTabId: string | null, position: number) => {
    const { placements } = await api.moveTab(tabId, { parentTabId, position });
    setTabs((current) => applyPlacements(current, placements));
  };

  const deleteTab = async (tabId: string) => {
    const { tabIds } = await api.deleteTab(tabId);
    setTabs((current) => removeTabs(current, tabIds));
  };

  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ tabId: string; anchor: DocAnchor } | null>(null);
  const [docBody, setDocBody] = useState<HTMLDivElement | null>(null);
  const narrow = useMediaQuery("(max-width: 1279px)");
  const canSendToAgent = useSyncExternalStore(subscribeSendToAgent, hasSendToAgentHandler);

  const threads = useMemo(() => groupThreads(comments.comments.values()), [comments.comments]);
  const openThreads = useMemo(
    () =>
      threads.filter(
        (thread) => thread.root.tabId === activeTabId && thread.root.resolvedAt === null,
      ),
    [threads, activeTabId],
  );
  const resolvedThreads = threads.filter(
    (thread) => thread.root.resolvedAt !== null && tabs.has(thread.root.tabId),
  );
  const draftAnchor = draft && draft.tabId === activeTabId ? draft.anchor : null;
  const anchors = useMemo(
    () => [
      ...openThreads.map(({ root }) => ({
        id: root.id,
        quote: root.quote,
        prefix: root.prefix,
        suffix: root.suffix,
      })),
      ...(draftAnchor ? [{ id: DRAFT_COMMENT_ID, ...draftAnchor }] : []),
    ],
    [openThreads, draftAnchor],
  );

  const startComment = () => {
    const anchor = editor ? selectionAnchor(editor) : null;
    if (!anchor || !activeTabId) return;
    setDraft({ tabId: activeTabId, anchor });
    setActiveCommentId(DRAFT_COMMENT_ID);
  };

  const { tops, selectionTop } = useEditorComments(editor, {
    anchors,
    activeId: activeCommentId,
    container: docBody,
    onClick: setActiveCommentId,
    onShortcut: startComment,
  });

  const commentFailed = (cause: unknown) => {
    setNotice("Could not update the comment. Reload and try again.");
    throw cause;
  };
  const quietly = (promise: Promise<unknown>) => void promise.catch(() => undefined);

  const handlersFor = (thread: CommentThread) => ({
    onReply: (body: string) => comments.actions.reply(thread.root.id, body).catch(commentFailed),
    onResolve: () => {
      setActiveCommentId(null);
      quietly(comments.actions.setResolved(thread.root.id, true).catch(commentFailed));
    },
    onDelete: (commentId: string) =>
      quietly(comments.actions.delete(commentId).catch(commentFailed)),
    ...(canSendToAgent
      ? {
          onSendToAgent: () =>
            sendThreadToAgent({
              docId: props.docId,
              tabId: thread.root.tabId,
              thread,
              url: `${window.location.origin}${docPath(props.docId, thread.root.tabId)}`,
            }),
        }
      : {}),
  });

  if (!doc) return null;

  return (
    <div className="doc-layout">
      <aside className="doc-rail doc-rail-left">
        <TabRail
          tabs={tabList}
          activeTabId={activeTabId}
          onSelect={(tabId) => navigate(docPath(props.docId, tabId))}
          onCreate={(parentTabId) => void createTab(parentTabId).catch(report("create"))}
          onRename={(tabId, title) => void renameTab(tabId, title).catch(report("rename"))}
          onMove={(tabId, parentTabId, position) =>
            void moveTab(tabId, parentTabId, position).catch(report("move"))
          }
          onDelete={(tabId) => void deleteTab(tabId).catch(report("delete"))}
        />
      </aside>
      <main className="doc-main">
        <div className="doc-header">
          <p className="doc-title">{doc.title}</p>
          <ResolvedComments
            threads={resolvedThreads}
            tabs={tabs}
            onReopen={(commentId) =>
              quietly(comments.actions.setResolved(commentId, false).catch(commentFailed))
            }
            onDelete={(commentId) =>
              quietly(comments.actions.delete(commentId).catch(commentFailed))
            }
          />
          <ExportMenu
            docId={props.docId}
            docTitle={doc.title}
            tabId={activeTabId}
            flush={async () => saver.current?.flush()}
          />
        </div>
        {notice ? (
          <div className="notice" role="status">
            {notice}
            <button type="button" className="link-button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {activeTab ? (
          <div className="doc-body" ref={setDocBody}>
            <TabEditor
              key={activeTab.id}
              markdown={activeTab.markdown}
              revision={revision}
              onChange={(markdown) => saver.current?.schedule(markdown)}
              onEditor={setEditor}
            />
            <CommentMargin
              threads={openThreads}
              tops={tops}
              activeId={activeCommentId}
              narrow={narrow}
              selectionTop={selectionTop}
              draftOpen={draftAnchor !== null}
              onStartComment={startComment}
              onSubmitDraft={async (body) => {
                if (!draft) return;
                const comment = await comments.actions
                  .create(draft.tabId, draft.anchor, body)
                  .catch(commentFailed);
                setDraft(null);
                setActiveCommentId(comment.id);
              }}
              onCancelDraft={() => {
                setDraft(null);
                setActiveCommentId(null);
              }}
              onActivate={setActiveCommentId}
              handlersFor={handlersFor}
            />
          </div>
        ) : null}
      </main>
      <aside className="doc-rail doc-rail-right">
        <OutlineRail editor={editor} />
      </aside>
    </div>
  );
}
