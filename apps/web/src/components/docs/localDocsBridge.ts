import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  LOCAL_RESPONSE_TYPE,
  localDocVersion,
  type LocalDocFile,
  type LocalDocRequest,
  type LocalDocRequestKind,
  type LocalDocResults,
  type LocalDocSummary,
  type LocalRequestMessage,
  type LocalResponseMessage,
} from "@t3tools/shared/docsCloudLocal";

/** Disk access for the project's docs, over the environment connection. */
export interface LocalDocsFiles {
  readonly list: () => Promise<ReadonlyArray<LocalDocSummary>>;
  /** Always a fresh read, never a cached one, since saves compare against it. */
  readonly read: (
    path: string,
  ) => Promise<{ readonly contents: string; readonly truncated: boolean }>;
  readonly write: (path: string, contents: string) => Promise<void>;
}

/** The project whose files the Docs Cloud frame may open. */
export interface LocalDocsContext {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly canWrite: boolean;
  readonly files: LocalDocsFiles;
}

export type LocalDocsHandler<K extends LocalDocRequestKind> = (
  request: Extract<LocalDocRequest, { kind: K }>,
  context: LocalDocsContext,
) => Promise<LocalDocResults[K]>;

/**
 * Answers by request kind. The panel combines the tables it serves, so a
 * feature adds its handlers in its own module and joins them in
 * `DocsCloudPanel`.
 */
export type LocalDocsHandlers = { readonly [K in LocalDocRequestKind]?: LocalDocsHandler<K> };

async function readDoc(path: string, context: LocalDocsContext): Promise<LocalDocFile> {
  const { contents, truncated } = await context.files.read(path);
  return {
    path,
    markdown: contents,
    version: localDocVersion(contents),
    readOnlyReason: !context.canWrite
      ? "This connection cannot edit files."
      : truncated
        ? "This file is too large to edit here."
        : null,
  };
}

export const LOCAL_FILE_HANDLERS = {
  "files.list": async (_request, context) => ({ files: await context.files.list() }),
  "file.read": (request, context) => readDoc(request.path, context),
  // The file is read again right before writing: text that changed on disk
  // since the editor loaded it comes back as a conflict, never overwritten.
  "file.write": async (request, context) => {
    if (!context.canWrite) throw new Error("This connection cannot edit files.");
    const current = await readDoc(request.path, context);
    if (current.readOnlyReason !== null) throw new Error(current.readOnlyReason);
    if (current.version !== request.baseVersion) return { status: "conflict", file: current };
    await context.files.write(request.path, request.markdown);
    return { status: "saved", version: localDocVersion(request.markdown) };
  },
} satisfies LocalDocsHandlers;

function errorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  return (message || "T3 Code could not do that.").slice(0, 1_000);
}

/** The reply to one frame request; failures become an error reply, never a throw. */
export async function answerLocalDocsRequest(
  message: LocalRequestMessage,
  handlers: LocalDocsHandlers,
  context: LocalDocsContext,
): Promise<LocalResponseMessage> {
  const { requestId, request } = message;
  const handler = handlers[request.kind] as LocalDocsHandler<typeof request.kind> | undefined;
  if (!handler) {
    return {
      type: LOCAL_RESPONSE_TYPE,
      requestId,
      ok: false,
      error: "This version of T3 Code cannot do that.",
    };
  }
  try {
    const result = await handler(request as never, context);
    return { type: LOCAL_RESPONSE_TYPE, requestId, ok: true, result };
  } catch (cause) {
    return { type: LOCAL_RESPONSE_TYPE, requestId, ok: false, error: errorText(cause) };
  }
}
