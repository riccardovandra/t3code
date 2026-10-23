import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { DocSummary, RoomMessage, Tab } from "../../shared/protocol.ts";
import { api, clientId } from "../api.ts";
import { ExportMenu } from "../doc/ExportMenu.tsx";
import { OutlineRail } from "../doc/OutlineRail.tsx";
import { TabRail } from "../doc/TabRail.tsx";
import { TabSaver } from "../doc/tabSaver.ts";
import { orderTabs } from "../doc/tabTree.ts";
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

  const load = useCallback(async () => {
    const loaded = await api.doc(props.docId);
    setDoc(loaded.doc);
    setTabs(new Map(loaded.tabs.map((tab) => [tab.id, tab])));
  }, [props.docId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabList = [...tabs.values()];
  const activeTab =
    (props.tabId ? tabs.get(props.tabId) : undefined) ?? orderTabs(tabList)[0]?.tab ?? null;
  const activeTabId = activeTab?.id ?? null;

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
      if (message.type === "tab.created") {
        upsertTab(message.tab);
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

  const createTab = async () => {
    const { tab } = await api.createTab(props.docId, { title: `Tab ${tabs.size + 1}` });
    upsertTab(tab);
    navigate(docPath(props.docId, tab.id));
  };

  if (!doc) return null;

  return (
    <div className="doc-layout">
      <aside className="doc-rail doc-rail-left">
        <TabRail
          tabs={tabList}
          activeTabId={activeTabId}
          onSelect={(tabId) => navigate(docPath(props.docId, tabId))}
          onCreate={createTab}
        />
      </aside>
      <main className="doc-main">
        <div className="doc-header">
          <p className="doc-title">{doc.title}</p>
          <ExportMenu
            docId={props.docId}
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
          <TabEditor
            key={activeTab.id}
            markdown={activeTab.markdown}
            revision={revision}
            onChange={(markdown) => saver.current?.schedule(markdown)}
            onEditor={setEditor}
          />
        ) : null}
      </main>
      <aside className="doc-rail doc-rail-right">
        <OutlineRail editor={editor} />
      </aside>
    </div>
  );
}
