import { docsCloudPath, parseDocsCloudFrameRequest } from "@t3tools/client-runtime/docs-cloud";
import {
  answerLocalDocsRequest,
  LOCAL_FILE_HANDLERS,
  type LocalDocsContext,
} from "@t3tools/client-runtime/docs-cloud-local-host";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AuthFilesystemWriteScope, type ProjectId, type ScopedThreadRef } from "@t3tools/contracts";
import {
  LOCAL_COMMENTS_CHANGED_TYPE,
  LOCAL_COMMENTS_FEATURE,
  LOCAL_FILES_CHANGED_TYPE,
  LOCAL_FILES_FEATURE,
  localDocPathFromAppPath,
  parseLocalRequestMessage,
} from "@t3tools/shared/docsCloudLocal";
import { docsCloudProjectKey } from "@t3tools/shared/docsCloudProjects";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useActiveThemeColors } from "~/hooks/useHtmlRenderTheme";
import { buildDocsCloudReviewComment } from "~/reviewCommentContext";
import { useRightPanelStore } from "~/rightPanelStore";
import { useProject, useQuietThreadShell, useThreadShell } from "~/state/entities";
import { useEnvironment } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
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
import { localDocsFiles } from "./localDocsFiles";
import {
  localCommentHandlers,
  localDocCommentsApi,
  useAgentRunCompletions,
  useAgentThreadIds,
} from "./localDocComments";

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
  /** The composer draft that "Add to chat" puts comments in. */
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly projectId: ProjectId | null;
  /** The thread's checkout; with a project, Docs Cloud can open its files under docs/. */
  readonly workspaceRoot: string | undefined;
  readonly path: string | undefined;
}) {
  const { baseUrl, threadRef, path } = props;
  const origin = new URL(baseUrl).origin;
  const frame = useRef<HTMLIFrameElement>(null);
  // Only the first path loads through src; later ones navigate inside the app.
  const [src] = useState(() => `${origin}${path ?? "/"}`);
  const reported = useRef<string | null>(null);
  const [copyRequest, setCopyRequest] = useState<CopyToClaudeDocRequest | null>(null);
  // The library opens on this T3 project's Docs Cloud project. The key
  // changes once the repository identity resolves, so the context is resent.
  const project = useProject(
    props.projectId === null
      ? null
      : { environmentId: threadRef.environmentId, projectId: props.projectId },
  );
  const scratchRoot = useEnvironment(threadRef.environmentId)?.serverConfig?.scratchWorkspaceRoot;
  // T3's scratch project means "no project", which Docs Cloud has its own of.
  const docsProject = project && !isScratchProject(project, scratchRoot) ? project : null;
  const projectName = docsProject?.title ?? null;
  const projectKey = docsProject ? docsCloudProjectKey(docsProject) : null;
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "t3-docs:context", projectName, projectKey },
      origin,
    );
  }, [origin, projectName, projectKey]);
  // Docs Cloud follows T3 Code's appearance and palette, custom themes included.
  const { appearance, colors } = useActiveThemeColors();
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "t3-docs:theme", appearance, colors },
      origin,
    );
  }, [origin, appearance, colors]);
  // True once the loaded frame has answered hello, so it can take requests.
  const [frameReady, setFrameReady] = useState(false);
  const navigate = useNavigate();
  const startWork = useStartWorkFromDoc(threadRef.environmentId, props.projectId);
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  // Failures go back to the frame, which shows them beside the button.
  const sendTo = useAtomCommand(serverEnvironment.sendDocsCloudTo, {
    label: "send Docs Cloud doc to another app",
    reportFailure: false,
  });
  const shell = useThreadShell(threadRef);

  const postToFrame = (message: Record<string, unknown>) =>
    frame.current?.contentWindow?.postMessage(message, origin);

  // The project's markdown files, read and written here over the environment
  // connection. Their text goes only to the frame, never to the Docs Cloud worker.
  const registry = useContext(RegistryContext);
  const canWriteFiles = useEnvironmentScope(threadRef.environmentId, AuthFilesystemWriteScope);
  const { workspaceRoot, projectId } = props;
  const localScope =
    projectId === null || workspaceRoot === undefined
      ? null
      : { environmentId: threadRef.environmentId, projectId, cwd: workspaceRoot };
  const localDocs: LocalDocsContext | null = localScope && {
    ...localScope,
    canWrite: canWriteFiles,
    files: localDocsFiles(registry, localScope),
  };
  const servesFiles = localDocs !== null;
  // Comments on those files stay on the T3 server, as the old Docs panel kept them.
  const canComment = useAtomValue(
    serverEnvironment.createDocComment.permissionAtom(threadRef.environmentId),
  );
  const [agentThreadIds, reportAgentThreads] = useAgentThreadIds();
  const commentHandlers = localCommentHandlers({
    api: localDocCommentsApi(registry, threadRef.environmentId),
    canComment,
    sendFromThreadId: shell === null ? null : threadRef.threadId,
    addToChat: (comment) => addReviewComment(props.composerDraftTarget, comment),
    onAgentThreads: reportAgentThreads,
  });
  const features = [
    ...(startWork ? ["start-work"] : []),
    "add-to-chat",
    "send-to",
    ...(servesFiles ? [LOCAL_FILES_FEATURE, LOCAL_COMMENTS_FEATURE] : []),
  ];
  const featureKey = features.join(" ");
  const helloFeatures = useRef<string | null>(null);
  const sendHello = () => {
    helloFeatures.current = featureKey;
    postToFrame({ type: "t3-docs:hello", features });
  };
  // A frame already loaded hears about features that arrive later, e.g. the checkout.
  const resendHello = useEffectEvent(sendHello);
  useEffect(() => {
    if (frameReady && helloFeatures.current !== featureKey) resendHello();
  }, [featureKey, frameReady]);

  const onLocalRequest = useEffectEvent((data: unknown): boolean => {
    const request = parseLocalRequestMessage(data);
    if (request === null) return false;
    if (localDocs === null) return true;
    void answerLocalDocsRequest(
      request,
      { ...LOCAL_FILE_HANDLERS, ...commentHandlers },
      localDocs,
    ).then(postToFrame);
    return true;
  });

  // An agent turn may have edited the files or answered comments; the frame
  // reloads what it shows. Doc agent threads answer comments too.
  const postLocalChanges = () => {
    if (!servesFiles) return;
    frame.current?.contentWindow?.postMessage({ type: LOCAL_FILES_CHANGED_TYPE }, origin);
    frame.current?.contentWindow?.postMessage({ type: LOCAL_COMMENTS_CHANGED_TYPE }, origin);
  };
  useAgentRunCompletions(registry, threadRef.environmentId, agentThreadIds, postLocalChanges);
  const notifyRunCompleted = useEffectEvent(postLocalChanges);
  const latestRun = useQuietThreadShell(threadRef)?.latestRun ?? null;
  const runCompletion = latestRun?.completedAt
    ? `${latestRun.runId}:${latestRun.completedAt}`
    : null;
  const seenCompletion = useRef(runCompletion);
  useEffect(() => {
    if (runCompletion === seenCompletion.current) return;
    seenCompletion.current = runCompletion;
    notifyRunCompleted();
  }, [runCompletion]);

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
      case "t3-docs:add-comment-to-chat": {
        const { type: _type, anchor, ...comment } = request;
        addReviewComment(
          props.composerDraftTarget,
          buildDocsCloudReviewComment({ ...comment, ...(anchor === null ? {} : { anchor }) }),
        );
        return;
      }
      case "t3-docs:send-to": {
        const { requestId, docId, target } = request;
        void sendTo({ environmentId: threadRef.environmentId, input: { docId, target } }).then(
          (result) => {
            const failure = result._tag === "Success" ? null : squashAtomCommandFailure(result);
            postToFrame({
              type: "t3-docs:sent-to",
              requestId,
              url: result._tag === "Success" ? result.value.url : null,
              error:
                failure === null
                  ? null
                  : failure instanceof Error && failure.message
                    ? failure.message
                    : "The doc could not be sent. Try again.",
            });
          },
        );
        return;
      }
    }
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      if (onLocalRequest(event.data)) return;
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
        {/* A project file only opens inside T3 Code, which serves it. */}
        {localDocPathFromAppPath(path ?? "/") === null ? (
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
        ) : null}
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
          sendHello();
          postToFrame({ type: "t3-docs:context", projectName, projectKey });
          postToFrame({ type: "t3-docs:theme", appearance, colors });
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
