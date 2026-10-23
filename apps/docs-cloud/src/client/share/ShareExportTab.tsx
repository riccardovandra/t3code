import { useState } from "react";

import { copyMarkdown, download, tabExportPath } from "../doc/ExportMenu.tsx";

/**
 * The Share panel's Export segment. For now the same actions as the header's
 * Export menu; S10 replaces this component's body, keeping its props.
 */
export function ShareExportTab(props: {
  readonly docId: string;
  readonly tabId: string | null;
  /** Saves the open tab's pending edit, so exports include it. */
  readonly flush: () => Promise<void>;
}) {
  const { docId, tabId, flush } = props;
  const [status, setStatus] = useState<string | null>(null);
  const docExportPath = `/api/docs/${docId}/export.md`;

  const run = (action: () => Promise<unknown>, done?: string) => {
    setStatus(null);
    action().then(
      () => setStatus(done ?? null),
      () => setStatus("Export failed"),
    );
  };

  return (
    <div className="share-export">
      <div className="share-export-actions">
        <button
          type="button"
          className="share-export-action"
          onClick={() => run(() => flush().then(() => download(docExportPath)))}
        >
          Download doc as Markdown
        </button>
        <button
          type="button"
          className="share-export-action"
          onClick={() => run(() => copyMarkdown(flush, docExportPath), "Copied")}
        >
          Copy doc as Markdown
        </button>
        {tabId ? (
          <>
            <button
              type="button"
              className="share-export-action"
              onClick={() => run(() => flush().then(() => download(tabExportPath(tabId))))}
            >
              Download this tab as Markdown
            </button>
            <button
              type="button"
              className="share-export-action"
              onClick={() => run(() => copyMarkdown(flush, tabExportPath(tabId)), "Copied")}
            >
              Copy this tab as Markdown
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="share-export-action"
          onClick={() => run(async () => window.print())}
        >
          Print / Save as PDF
        </button>
      </div>
      {status ? (
        <p className="muted share-status" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
