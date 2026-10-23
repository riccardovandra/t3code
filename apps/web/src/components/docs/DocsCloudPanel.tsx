import { docsCloudPath, parseDocsCloudFrameRequest } from "@t3tools/client-runtime/docs-cloud";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, FolderIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { useProject, useThreadShell } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";

import { Button } from "../ui/button";
import { type CopyToClaudeDocRequest, parseCopyToClaudeDocMessage } from "./copyToClaudeDoc";
import { CopyToClaudeDocDialog } from "./CopyToClaudeDocDialog";
import {
  clearPendingDocLink,
  openableDocThreads,
  pendingDocLink,
  toThreadRef,
  useStartWorkFromDoc,
} from "./docsCloudWork";

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
  // The library opens on the Docs Cloud project named after this T3 project.
  const projectName =
    useProject(
      props.projectId === null
        ? null
        : { environmentId: threadRef.environmentId, projectId: props.projectId },
    )?.title ?? null;
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "t3-docs:context", projectName }, origin);
  }, [origin, projectName]);
  // True once the loaded frame has answered hello, so it can take requests.
  const [frameReady, setFrameReady] = useState(false);
  const navigate = useNavigate();
  const startWork = useStartWorkFromDoc(threadRef.environmentId, props.projectId);
  const sendComment = useAtomCommand(
    serverEnvironment.sendDocsCloudComment,
    "send Docs Cloud comment to agent",
  );
  const shell = useThreadShell(threadRef);

  const postToFrame = (message: Record<string, unknown>) =>
    frame.current?.contentWindow?.postMessage(message, origin);

  const onFrameRequest = useEffectEvent((data: unknown) => {
    const request = parseDocsCloudFrameRequest(data, origin);
    if (request === null) return;
    switch (request.type) {
      case "t3-docs:start-work": {
        const docPath = docsCloudPath(request.url, origin);
        if (startWork && docPath !== null) void startWork(request, docPath);
        return;
      }
      case "t3-docs:resolve-threads":
        postToFrame({ type: "t3-docs:threads", threads: openableDocThreads(request.threads) });
        return;
      case "t3-docs:open-thread": {
        const ref = toThreadRef(request);
        if (openableDocThreads([request]).length === 0) return;
        void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
        return;
      }
      case "t3-docs:thread-linked":
        clearPendingDocLink(toThreadRef(request), request.docId);
        return;
      case "t3-docs:send-comment": {
        const { type: _type, ...comment } = request;
        void sendComment({
          environmentId: threadRef.environmentId,
          input: { ...comment, fromThreadId: threadRef.threadId },
        }).then((result) =>
          postToFrame({
            type: "t3-docs:comment-sent",
            requestId: request.requestId,
            error:
              result._tag === "Success"
                ? null
                : "The comment could not be sent to the agent. Try again.",
          }),
        );
        return;
      }
    }
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const copy = parseCopyToClaudeDocMessage(event.data, origin);
      if (copy) {
        setCopyRequest(copy);
        return;
      }
      if (!isLocationMessage(event.data)) {
        onFrameRequest(event.data);
        return;
      }
      reported.current = event.data.path;
      setFrameReady(true);
      useRightPanelStore.getState().selectDocsCloud(threadRef, event.data.path, true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, threadRef]);

  // A thread started from a doc is linked once it exists, i.e. once its draft
  // is sent. The frame acknowledges with thread-linked, which clears it.
  const pendingDocId = shell === null ? undefined : pendingDocLink(threadRef);
  useEffect(() => {
    if (!frameReady || shell === null || pendingDocId === undefined) return;
    frame.current?.contentWindow?.postMessage(
      {
        type: "t3-docs:link-thread",
        docId: pendingDocId,
        environmentId: threadRef.environmentId,
        threadId: threadRef.threadId,
        title: shell.title,
      },
      origin,
    );
  }, [frameReady, shell, pendingDocId, threadRef, origin]);

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
          setFrameReady(false);
          frame.current?.contentWindow?.postMessage(
            {
              type: "t3-docs:hello",
              features: startWork ? ["start-work", "send-to-agent"] : ["send-to-agent"],
            },
            origin,
          );
          postToFrame({ type: "t3-docs:context", projectName });
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
