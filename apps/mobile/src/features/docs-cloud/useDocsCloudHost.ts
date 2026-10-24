import { useAtomValue } from "@effect/atom-react";
import { docsCloudPath, parseDocsCloudFrameRequest } from "@t3tools/client-runtime/docs-cloud";
import {
  latestRunCompletion,
  localCommentHandlers,
  localDocCommentsApi,
  watchRunCompletions,
} from "@t3tools/client-runtime/docs-cloud-local-comments";
import {
  answerLocalDocsRequest,
  LOCAL_FILE_HANDLERS,
  localDocsFiles,
  unsupportedLocalDocsReply,
  type LocalDocsContext,
} from "@t3tools/client-runtime/docs-cloud-local-host";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthFilesystemWriteScope,
  type EnvironmentId,
  type ReviewCommentContextRecord,
  type ThreadId,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import {
  LOCAL_COMMENTS_CHANGED_TYPE,
  LOCAL_COMMENTS_FEATURE,
  LOCAL_FILES_CHANGED_TYPE,
  LOCAL_FILES_FEATURE,
  LOCAL_REQUEST_TYPE,
  parseLocalRequestMessage,
} from "@t3tools/shared/docsCloudLocal";
import {
  NATIVE_READY_TYPE,
  nativeHostScript,
  parseNativeFrameMessage,
} from "@t3tools/shared/docsCloudNative";
import { docsCloudProjectKey } from "@t3tools/shared/docsCloudProjects";
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import type { WebView, WebViewMessageEvent } from "react-native-webview";

import * as Dialog from "../../components/ui/Dialog";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentServerConfig, useProject, useQuietThreadShell } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { environmentThreadShells } from "../../state/threads";
import {
  getComposerDraftSnapshot,
  insertComposerDraftContext,
} from "../../state/use-composer-drafts";
import { docsCloudCommentRecord, localDocCommentRecord } from "./docsCloudChat";

/** Appends a comment chip to the thread's draft; false when the draft has no room. */
function addRecordToDraft(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  record: ReviewCommentContextRecord,
): boolean {
  const draftKey = scopedThreadKey(environmentId, threadId);
  const draft = getComposerDraftSnapshot(draftKey);
  return insertComposerDraftContext(
    draftKey,
    {
      text: `${formatComposerContextReference(record)} `,
      context: { version: 1, records: [record] },
    },
    { text: draft.text, start: draft.text.length, end: draft.text.length },
  );
}

/** Doc agent threads seen in comments while the screen is open; the list only changes when one is added. */
function useAgentThreadIds() {
  const [ids, setIds] = useState<ReadonlyArray<ThreadId>>([]);
  const report = (next: ReadonlyArray<ThreadId>) =>
    setIds((current) =>
      next.every((id) => current.includes(id)) ? current : [...new Set([...current, ...next])],
    );
  return [ids, report] as const;
}

/**
 * The mobile app's side of the Docs Cloud embed protocol, which web's Docs
 * panel serves to its iframe. Docs Cloud is the WebView's top-level page, so
 * messages travel over the WebView bridge (`@t3tools/shared/docsCloudNative`).
 * With a thread, the page also opens the project's files under docs/ and
 * their comments, read and written over the environment connection.
 */
export function useDocsCloudHost(props: {
  readonly webView: RefObject<WebView<object> | null>;
  readonly baseUrl: string | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
}) {
  const { webView, baseUrl, environmentId, threadId } = props;
  const origin = baseUrl === null ? null : new URL(baseUrl).origin;
  const threadRef = threadId === null ? null : { environmentId, threadId };
  const shell = useQuietThreadShell(threadRef);
  const project = useProject(shell ? { environmentId, projectId: shell.projectId } : null);
  const scratchRoot = useEnvironmentServerConfig(environmentId)?.scratchWorkspaceRoot;
  // T3's scratch project means "no project", which Docs Cloud has its own of.
  const docsProject = project && !isScratchProject(project, scratchRoot) ? project : null;
  const projectName = docsProject?.title ?? null;
  const projectKey = docsProject ? docsCloudProjectKey(docsProject) : null;

  const canWrite = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const canComment = useAtomValue(serverEnvironment.createDocComment.permissionAtom(environmentId));
  const canSendTo = useAtomValue(serverEnvironment.sendDocsCloudTo.permissionAtom(environmentId));
  const cwd = shell?.worktreePath ?? project?.workspaceRoot ?? null;
  const localScope =
    shell === null || cwd === null ? null : { environmentId, projectId: shell.projectId, cwd };
  const localDocs: LocalDocsContext | null = localScope && {
    ...localScope,
    canWrite,
    files: localDocsFiles(
      appAtomRegistry,
      { server: serverEnvironment, projects: projectEnvironment },
      localScope,
    ),
  };
  const [agentThreadIds, reportAgentThreads] = useAgentThreadIds();
  const handlers = {
    ...LOCAL_FILE_HANDLERS,
    ...localCommentHandlers({
      api: localDocCommentsApi(appAtomRegistry, serverEnvironment, environmentId),
      canComment,
      sendFromThreadId: threadId,
      addToChat:
        threadId === null
          ? null
          : (path, thread) => {
              if (!addRecordToDraft(environmentId, threadId, localDocCommentRecord(path, thread))) {
                throw new Error("Remove some context from the draft and try again.");
              }
            },
      onAgentThreads: reportAgentThreads,
    }),
  };

  const features = [
    ...(threadId === null ? [] : ["add-to-chat"]),
    ...(canSendTo ? ["send-to"] : []),
    ...(localDocs === null ? [] : [LOCAL_FILES_FEATURE, LOCAL_COMMENTS_FEATURE]),
  ];
  const featureKey = features.join(" ");

  const post = (message: unknown) => {
    if (origin !== null) webView.current?.injectJavaScript(nativeHostScript(origin, message));
  };
  // Set once the loaded page says it listens; a reloaded page says so again.
  const pageReady = useRef(false);
  const helloFeatures = useRef<string | null>(null);
  const sendHello = () => {
    helloFeatures.current = featureKey;
    post({ type: "t3-docs:hello", features });
    post({ type: "t3-docs:context", projectName, projectKey });
  };
  // A page already loaded hears about features that arrive later, e.g. the project.
  const resendHello = useEffectEvent(sendHello);
  useEffect(() => {
    if (pageReady.current && helloFeatures.current !== featureKey) resendHello();
  }, [featureKey]);
  // The project's key changes once its repository identity resolves.
  const resendContext = useEffectEvent((name: string | null, key: string | null) => {
    if (pageReady.current) post({ type: "t3-docs:context", projectName: name, projectKey: key });
  });
  useEffect(() => resendContext(projectName, projectKey), [projectName, projectKey]);

  // An agent turn may have edited the files or answered comments, in this
  // thread or in a doc agent thread; the page reloads what it shows.
  const postLocalChanges = useEffectEvent(() => {
    if (!pageReady.current || localDocs === null) return;
    post({ type: LOCAL_FILES_CHANGED_TYPE });
    post({ type: LOCAL_COMMENTS_CHANGED_TYPE });
  });
  useEffect(
    () =>
      watchRunCompletions(
        appAtomRegistry,
        (id) => environmentThreadShells.quietThreadShellAtom({ environmentId, threadId: id }),
        agentThreadIds,
        () => postLocalChanges(),
      ),
    [environmentId, agentThreadIds],
  );
  const runCompletion = latestRunCompletion(shell);
  const seenCompletion = useRef(runCompletion);
  useEffect(() => {
    if (runCompletion === seenCompletion.current) return;
    seenCompletion.current = runCompletion;
    postLocalChanges();
  }, [runCompletion]);

  const onMessage = (event: WebViewMessageEvent) => {
    // Only the configured Docs Cloud may ask; the screen keeps the WebView on it.
    if (baseUrl === null || origin === null) return;
    if (docsCloudPath(event.nativeEvent.url, baseUrl) === null) return;
    const data = parseNativeFrameMessage(event.nativeEvent.data);
    if (typeof data !== "object" || data === null) return;
    const type = (data as { type?: unknown }).type;
    if (type === NATIVE_READY_TYPE) {
      pageReady.current = true;
      sendHello();
      return;
    }
    if (type === LOCAL_REQUEST_TYPE) {
      const request = parseLocalRequestMessage(data);
      if (request === null) {
        const reply = unsupportedLocalDocsReply(data);
        if (reply) post(reply);
        return;
      }
      if (localDocs === null) {
        post(unsupportedLocalDocsReply(data));
        return;
      }
      void answerLocalDocsRequest(request, handlers, localDocs).then(post);
      return;
    }
    const request = parseDocsCloudFrameRequest(data, origin);
    if (request?.type === "t3-docs:add-comment-to-chat") {
      if (threadId === null) return;
      const { type: _type, ...comment } = request;
      if (!addRecordToDraft(environmentId, threadId, docsCloudCommentRecord(comment))) {
        Dialog.alert("Too many context items", "Remove some context from the draft and try again.");
      }
    } else if (request?.type === "t3-docs:send-to") {
      const { requestId, docId, target } = request;
      void runAtomCommand(
        appAtomRegistry,
        serverEnvironment.sendDocsCloudTo,
        { environmentId, input: { docId, target } },
        { reportFailure: false, reportDefect: false },
      ).then((result) => {
        const failure = result._tag === "Success" ? null : squashAtomCommandFailure(result);
        post({
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
      });
    }
  };

  return { onMessage };
}
