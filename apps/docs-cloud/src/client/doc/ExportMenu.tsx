import { useRef, useState, useSyncExternalStore } from "react";

import { hasEmbedParent, postToEmbedParent, subscribeEmbedParent } from "../embedBridge.ts";
import { docPath } from "../router.ts";
import { readyWidgetsForPrint } from "../editor/widget/WidgetView.ts";

const tabExportPath = (tabId: string) => `/api/tabs/${tabId}/export.md`;

function download(path: string) {
  const link = document.createElement("a");
  link.href = path;
  link.download = "";
  link.click();
}

async function fetchMarkdown(path: string): Promise<string> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export function ExportMenu(props: {
  readonly docId: string;
  readonly docTitle: string;
  readonly tabId: string | null;
  /** Saves the open tab's pending edit, so exports include it. */
  readonly flush: () => Promise<void>;
}) {
  const { docId, tabId, flush } = props;
  const menu = useRef<HTMLDetailsElement>(null);
  const inT3Code = useSyncExternalStore(subscribeEmbedParent, hasEmbedParent);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (menu.current) menu.current.open = false;
    setStatus(null);
    try {
      await action();
    } catch {
      setStatus("Export failed");
    }
  };

  const copyTab = (id: string) =>
    run(async () => {
      const markdown = flush().then(() => fetchMarkdown(tabExportPath(id)));
      // Handing the clipboard a promise keeps the click's user activation in
      // Safari, which rejects a write that starts after an await.
      if (typeof ClipboardItem !== "undefined") {
        const blob = markdown.then((text) => new Blob([text], { type: "text/plain" }));
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      } else {
        await navigator.clipboard.writeText(await markdown);
      }
      setStatus("Copied");
    });

  return (
    <div className="export-menu-wrap">
      {status ? (
        <span className="muted" role="status">
          {status}
        </span>
      ) : null}
      <details className="export-menu" ref={menu}>
        <summary>Export</summary>
        <div className="export-menu-items" role="menu">
          {tabId ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  void run(async () => {
                    await flush();
                    download(tabExportPath(tabId));
                  })
                }
              >
                Download tab as Markdown
              </button>
              <button type="button" role="menuitem" onClick={() => void copyTab(tabId)}>
                Copy tab as Markdown
              </button>
            </>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void run(async () => {
                await flush();
                download(`/api/docs/${docId}/export.md`);
              })
            }
          >
            Download doc as Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void run(async () => {
                await readyWidgetsForPrint();
                window.print();
              })
            }
          >
            Print / Save as PDF
          </button>
          {inT3Code ? (
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                void run(async () => {
                  // The agent reads the doc from the server, so pending edits go first.
                  await flush();
                  postToEmbedParent({
                    type: "t3-docs:copy-to-claude-doc",
                    docId,
                    title: props.docTitle,
                    url: `${window.location.origin}${docPath(docId)}`,
                  });
                })
              }
            >
              Copy to Claude Doc…
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
