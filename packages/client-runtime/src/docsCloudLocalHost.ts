import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  LOCAL_REQUEST_TYPE,
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
import type { AtomRegistry } from "effect/reactivity";

import type { createProjectEnvironmentAtoms } from "./state/projectCommands.ts";
import {
  executeAtomQuery,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "./state/runtime.ts";
import type { createServerEnvironmentAtoms } from "./state/server.ts";

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
 * Answers by request kind. A host combines the tables it serves, so a
 * feature adds its handlers in its own module and each host (the web Docs
 * panel, the mobile Docs screen) joins them.
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

/**
 * An error reply for a request this host could not parse, such as a kind a
 * newer Docs Cloud added, so the frame fails fast instead of waiting out its
 * timeout. Null when the message is not a local request with an id.
 */
export function unsupportedLocalDocsReply(data: unknown): LocalResponseMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, requestId } = data as { type?: unknown; requestId?: unknown };
  if (type !== LOCAL_REQUEST_TYPE || typeof requestId !== "string") return null;
  if (requestId.length === 0 || requestId.length > 100) return null;
  return {
    type: LOCAL_RESPONSE_TYPE,
    requestId,
    ok: false,
    error: "This version of T3 Code cannot do that.",
  };
}

const QUIET = { reportFailure: false, reportDefect: false } as const;

/** The value of a settled RPC, or its failure thrown as an Error the frame can show. */
export function localDocsValueOf<A>(result: AtomCommandResult<A, unknown>, fallback: string): A {
  if (result._tag === "Success") return result.value;
  const failure = squashAtomCommandFailure(result);
  throw failure instanceof Error && failure.message ? failure : new Error(fallback);
}

/** The RPC atoms a client app built for its environment connection. */
export interface LocalDocsFilesAtoms {
  readonly server: Pick<ReturnType<typeof createServerEnvironmentAtoms>, "docsCloudImports">;
  readonly projects: Pick<
    ReturnType<typeof createProjectEnvironmentAtoms>,
    "readFile" | "writeFile"
  >;
}

/** The project's docs through the environment RPCs, so remote and tunnel work too. */
export function localDocsFiles(
  registry: AtomRegistry.AtomRegistry,
  atoms: LocalDocsFilesAtoms,
  scope: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly cwd: string;
  },
): LocalDocsFiles {
  const { environmentId, projectId, cwd } = scope;
  const fileAtom = (relativePath: string) =>
    atoms.projects.readFile({ environmentId, input: { cwd, relativePath } });
  return {
    list: async () => {
      const result = await executeAtomQuery(
        registry,
        atoms.server.docsCloudImports({ environmentId, input: { projectId, cwd } }),
        { ...QUIET, refresh: true },
      );
      return localDocsValueOf(result, "Could not list the project's docs.").docs.map((doc) => ({
        path: doc.docPath,
        title: doc.title,
      }));
    },
    read: async (path) => {
      const result = await executeAtomQuery(registry, fileAtom(path), { ...QUIET, refresh: true });
      const { contents, truncated } = localDocsValueOf(result, "Could not read the file.");
      return { contents, truncated };
    },
    write: async (path, contents) => {
      const result = await runAtomCommand(
        registry,
        atoms.projects.writeFile,
        { environmentId, input: { cwd, relativePath: path, contents } },
        QUIET,
      );
      localDocsValueOf(result, "Could not save the file.");
      // Other views of the file, such as the file preview, catch up.
      registry.refresh(fileAtom(path));
    },
  };
}
