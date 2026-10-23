import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, FolderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useRightPanelStore } from "~/rightPanelStore";

import { Button } from "../ui/button";
import { type CopyToClaudeDocRequest, parseCopyToClaudeDocMessage } from "./copyToClaudeDoc";
import { CopyToClaudeDocDialog } from "./CopyToClaudeDocDialog";

interface EmbedLocationMessage {
  readonly type: "t3-docs:location";
  readonly path: string;
}

function isLocationMessage(value: unknown): value is EmbedLocationMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "t3-docs:location" &&
    typeof (value as { path?: unknown }).path === "string" &&
    (value as { path: string }).path.startsWith("/")
  );
}

/**
 * The hosted Docs Cloud app beside the chat. The browser talks to Docs Cloud
 * directly with its own session cookie, so nothing goes through the T3
 * server and remote connections behave the same as local ones.
 */
export function DocsCloudPanel(props: {
  readonly baseUrl: string;
  readonly threadRef: ScopedThreadRef;
  readonly projectId: ProjectId | null;
  readonly path: string | undefined;
  readonly onShowFiles: (() => void) | null;
}) {
  const { baseUrl, threadRef, path } = props;
  const origin = new URL(baseUrl).origin;
  const frame = useRef<HTMLIFrameElement>(null);
  // Only the first path loads through src; later ones navigate inside the app.
  const [src] = useState(() => `${origin}${path ?? "/"}`);
  const reported = useRef<string | null>(null);
  const [copyRequest, setCopyRequest] = useState<CopyToClaudeDocRequest | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const copy = parseCopyToClaudeDocMessage(event.data, origin);
      if (copy) {
        setCopyRequest(copy);
        return;
      }
      if (!isLocationMessage(event.data)) return;
      reported.current = event.data.path;
      useRightPanelStore.getState().selectDocsCloud(threadRef, event.data.path, true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, threadRef]);

  useEffect(() => {
    if (path === undefined || reported.current === null || path === reported.current) return;
    frame.current?.contentWindow?.postMessage({ type: "t3-docs:navigate", path }, origin);
  }, [origin, path]);

  return (
    <section aria-label="Docs Cloud" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Docs Cloud</span>
        {props.onShowFiles ? (
          <Button size="xs" variant="ghost-muted" onClick={props.onShowFiles}>
            <FolderIcon />
            Project files
          </Button>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Open in browser"
          onClick={() =>
            window.open(`${origin}${reported.current ?? path ?? "/"}`, "_blank", "noopener")
          }
        >
          <ExternalLinkIcon />
        </Button>
      </div>
      <iframe
        ref={frame}
        title="Docs Cloud"
        src={src}
        allow="clipboard-read; clipboard-write"
        // Keeps the app's session, downloads and print, but not navigating T3 Code
        // away. It is cross-origin, so allow-same-origin cannot lift the sandbox.
        // oxlint-disable-next-line react/iframe-missing-sandbox
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        className="min-h-0 w-full flex-1 border-0 bg-background"
        onLoad={() => {
          reported.current = null;
          frame.current?.contentWindow?.postMessage({ type: "t3-docs:hello" }, origin);
        }}
      />
      {copyRequest ? (
        <CopyToClaudeDocDialog
          environmentId={threadRef.environmentId}
          projectId={props.projectId}
          request={copyRequest}
          onClose={() => setCopyRequest(null)}
        />
      ) : null}
    </section>
  );
}
