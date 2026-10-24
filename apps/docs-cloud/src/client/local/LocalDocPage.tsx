import { docTitleFromPath } from "@t3tools/shared/docPaths";
import type { Editor } from "@tiptap/core";
import { useEffect, useMemo, useRef, useState } from "react";

import { HomeLink } from "../home/HomeLink.tsx";
import { OutlineRail } from "../doc/OutlineRail.tsx";
import { useColumnWidth } from "../doc/toolbar/columnWidth.ts";
import { DocToolbar } from "../doc/toolbar/DocToolbar.tsx";
import { useStableCallback } from "../doc/useStableCallback.ts";
import { TabEditor } from "../editor/TabEditor.tsx";
import { useMe } from "../me.ts";
import { navigate } from "../router.ts";
import { DocSaver } from "./docSaver.ts";
import { localDocSource, type DocSnapshot, type DocSource } from "./docSource.ts";
import { hostClient, useLocalFilesAvailable } from "./hostClient.ts";
import { LocalRequestError } from "./localClient.ts";

const NO_TABS: ReadonlyArray<never> = [];
const noop = () => undefined;
const refuseImage = () => Promise.reject(new Error("Images cannot be added to project files."));

/** A T3 Code project file, on the local route. Only T3 Code can serve one. */
export function LocalDocPage(props: { readonly path: string }) {
  const available = useLocalFilesAvailable();
  const source = useMemo(() => localDocSource(hostClient, props.path), [props.path]);
  if (available === null) return null;
  if (!available) {
    return (
      <main className="home">
        <p className="home-empty">
          {docTitleFromPath(props.path)} is a project file. It opens in T3 Code&apos;s Docs panel.
        </p>
        <HomeLink />
      </main>
    );
  }
  return <LocalDoc path={props.path} source={source} />;
}

function LocalDoc(props: { readonly path: string; readonly source: DocSource }) {
  const { source } = props;
  const [snapshot, setSnapshot] = useState<DocSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  // Bumped when the file changed on disk underneath the editor.
  const [revision, setRevision] = useState(0);
  const saver = useRef<DocSaver | null>(null);
  const shown = useRef<DocSnapshot | null>(null);

  const show = (next: DocSnapshot) => {
    shown.current = next;
    setSnapshot(next);
  };
  /** Text from disk; the editor takes it only when it differs from what it has. */
  const adopt = useStableCallback((next: DocSnapshot) => {
    const current = shown.current;
    saver.current?.acceptRemote(next.version);
    if (current?.version === next.version && current.readOnlyReason === next.readOnlyReason) {
      return;
    }
    show(next);
    if (current !== null) setRevision((value) => value + 1);
  });

  const reload = useStableCallback(async () => {
    try {
      const next = await source.load();
      // An edit being saved wins; if the file moved on meanwhile, its save conflicts.
      if (saver.current?.dirty) return;
      adopt(next);
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof LocalRequestError ? cause.message : "Could not open the file.");
    }
  });

  useEffect(() => {
    void reload();
    return source.subscribe(() => void reload());
  }, [source, reload]);

  const loaded = snapshot !== null;
  useEffect(() => {
    if (!loaded) return;
    const docSaver = new DocSaver(source, shown.current?.version ?? "", {
      onSaved: (saved) => {
        setSaving(docSaver.pending);
        // The editor already has this text; only the version moves on.
        if (!shown.current) return;
        shown.current = { ...shown.current, version: saved };
        setSnapshot(shown.current);
      },
      onConflict: (current) => {
        setSaving(false);
        adopt(current);
        setNotice(
          "This file changed on disk, so it was reloaded. Your last edit was not saved over it.",
        );
      },
      onError: (cause) =>
        setNotice(
          cause instanceof LocalRequestError
            ? `Could not save: ${cause.message}`
            : "Could not save the file. Retrying.",
        ),
    });
    saver.current = docSaver;
    const flush = () => void docSaver.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      void docSaver.flush();
      if (saver.current === docSaver) saver.current = null;
    };
  }, [loaded, source, adopt]);

  const me = useMe();
  const [width, toggleWidth] = useColumnWidth(me?.user.id ?? "");
  const editable = snapshot !== null && snapshot.readOnlyReason === null;
  const insertImage = useStableCallback(() =>
    setNotice("Images cannot be added to project files here. Ask the agent to add one."),
  );
  const title = docTitleFromPath(props.path);

  return (
    <div className={`doc-page column-${width}`}>
      <div className="doc-chrome">
        <header className="doc-header">
          <div className="doc-header-title">
            <HomeLink />
            <span className="doc-header-crumb" aria-hidden="true">
              /
            </span>
            <span className="doc-title-text local-doc-title">{title}</span>
            <span className="local-doc-path">{props.path}</span>
          </div>
          <div className="doc-header-actions">
            <span className="local-doc-status" aria-live="polite">
              {saving ? "Saving…" : null}
            </span>
          </div>
        </header>
        <div className="doc-toolbar">
          {/* No tabs: a project file is one page. */}
          <DocToolbar
            tabs={NO_TABS}
            activeTabId={null}
            editable={editable}
            editor={editor}
            width={width}
            onToggleWidth={toggleWidth}
            onInsertImage={insertImage}
            onSelect={noop}
            onCreate={noop}
            onRename={noop}
            onMove={noop}
            onDelete={noop}
          />
        </div>
      </div>
      <div className="doc-layout">
        <main className="doc-main">
          {notice ? (
            <div className="notice" role="status">
              {notice}
              <button type="button" className="link-button" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          ) : null}
          {snapshot?.readOnlyReason ? (
            <div className="notice" role="note">
              {snapshot.readOnlyReason}
            </div>
          ) : null}
          {loadError && snapshot === null ? (
            <div className="notice" role="alert">
              <p>This file can&apos;t be opened: {loadError}</p>
              <button type="button" className="link-button" onClick={() => navigate("/")}>
                All docs
              </button>
            </div>
          ) : null}
          {snapshot ? (
            // S2's comment margin sits beside the column here, as in DocPage.
            <div className="doc-body comments-hidden">
              <div className="doc-column">
                <div className="doc-head">
                  <h1 className="doc-head-title">{title}</h1>
                </div>
                <TabEditor
                  markdown={snapshot.markdown}
                  revision={revision}
                  editable={editable}
                  uploadImage={refuseImage}
                  onUploadError={insertImage}
                  onChange={(markdown) => {
                    setSaving(true);
                    saver.current?.schedule(markdown);
                  }}
                  onEditor={setEditor}
                />
              </div>
            </div>
          ) : null}
        </main>
        <aside className="doc-rail doc-rail-right">
          <OutlineRail editor={editor} />
        </aside>
      </div>
    </div>
  );
}
