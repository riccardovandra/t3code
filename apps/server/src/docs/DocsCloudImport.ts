/**
 * DocsCloudImport - keeps Docs Cloud's projects in step with this
 * environment's projects, and moves a project's markdown docs, with their open
 * comments, into Docs Cloud. The server holds the Docs Cloud token (the
 * `docs-cloud` MCP hub entry), so the project sync and imports run here rather
 * than in a client.
 *
 * @module DocsCloudImport
 */
import {
  type DocComment,
  DocsCloudError,
  type DocsCloudImportFileResult,
  type DocsCloudImportInput,
  type DocsCloudImportRecord,
  type DocsCloudImportResult,
  type DocsCloudImportsInput,
  type DocsCloudImportsResult,
  type DocsCloudProject,
  type DocsCloudSkippedComment,
  type McpServerEntry,
  type ProjectId,
  type RepositoryIdentity,
} from "@t3tools/contracts";
import { DOCS_ROOT, docTitleFromPath } from "@t3tools/shared/docPaths";
import { docsCloudProjectKey } from "@t3tools/shared/docsCloudProjects";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as McpServerRegistry from "../mcpHub/McpServerRegistry.ts";
import * as DocsCloudConnection from "./DocsCloudConnection.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import * as WorkspaceDocs from "../workspace/WorkspaceDocs.ts";
import * as DocCommentsService from "./DocCommentsService.ts";

/** Matches DOCS_CLOUD_SERVER_NAME in client-runtime's docsCloud.ts. */
const DOCS_CLOUD_SERVER_NAME = "docs-cloud";

/** The doc's title: its first `# ` heading, else the file name. */
export const importTitle = (docPath: string, markdown: string): string => {
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown)?.[1]?.trim();
  return heading ? heading.slice(0, 200) : docTitleFromPath(docPath);
};

interface Connection {
  readonly origin: string;
  readonly authorization: string;
}

const SyncedProjects = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({ id: Schema.String, key: Schema.String, name: Schema.String }),
  ),
});
const TabRef = Schema.Struct({ id: Schema.String, version: Schema.Number });
const DocWithTabs = Schema.Struct({
  doc: Schema.Struct({ id: Schema.String }),
  tabs: Schema.Array(TabRef),
});
const WrittenTab = Schema.Struct({ tab: TabRef });
const CreatedComment = Schema.Struct({ comment: Schema.Struct({ id: Schema.String }) });
const decodeErrorBody = Schema.decodeUnknownOption(
  Schema.Struct({ error: Schema.optional(Schema.String) }),
);

interface ImportRow {
  readonly doc_path: string;
  readonly doc_id: string;
  readonly tab_id: string;
  readonly imported_at: string;
}

export class DocsCloudImport extends Context.Service<
  DocsCloudImport,
  {
    /** This T3 project's Docs Cloud project (see `docsCloudProjectKey`), created on first use. */
    readonly project: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<DocsCloudProject, DocsCloudError>;
    /** Upserts every project of this environment into Docs Cloud, renaming them to match. */
    readonly syncProjects: Effect.Effect<ReadonlyArray<DocsCloudProject>, DocsCloudError>;
    /** The checkout's docs, and those already imported into the configured Docs Cloud. */
    readonly listImports: (
      input: DocsCloudImportsInput,
    ) => Effect.Effect<DocsCloudImportsResult, DocsCloudError>;
    /**
     * Imports each doc into its own Docs Cloud doc. A file that fails is
     * reported in its result; only a failure before any file (Docs Cloud not
     * set up, unreachable, or refusing the token) fails the whole call.
     */
    readonly importDocs: (
      input: DocsCloudImportInput,
    ) => Effect.Effect<DocsCloudImportResult, DocsCloudError>;
  }
>()("t3/docs/DocsCloudImport") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const http = yield* HttpClient.HttpClient;
  const registry = yield* McpServerRegistry.McpServerRegistry;
  const projects = yield* ProjectService.ProjectService;
  const repositories = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const workspaceDocs = yield* WorkspaceDocs.WorkspaceDocs;
  const comments = yield* DocCommentsService.DocCommentsService;

  const persistence = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapError((cause) => Effect.logWarning("Docs Cloud import record failed", { cause })),
      Effect.mapError(() => new DocsCloudError({ reason: "persistence" })),
    );

  const entry = registry.list.pipe(
    Effect.map(({ servers }) =>
      servers.find(
        (server): server is McpServerEntry & { transport: { type: "http"; url: string } } =>
          server.name === DOCS_CLOUD_SERVER_NAME && server.transport.type === "http",
      ),
    ),
    Effect.mapError((cause) => new DocsCloudError({ reason: "failed", detail: cause.message })),
  );

  const originOf = (url: string) => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  };

  const connection = Effect.gen(function* () {
    const server = yield* entry;
    const origin = server ? originOf(server.transport.url) : null;
    if (!server || origin === null) {
      return yield* new DocsCloudError({ reason: "not_configured" });
    }
    const { headers } = yield* registry
      .credentials(server)
      .pipe(Effect.mapError(() => new DocsCloudError({ reason: "not_configured" })));
    const authorization = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === "authorization",
    )?.[1];
    if (!authorization) return yield* new DocsCloudError({ reason: "not_configured" });
    return { origin, authorization } satisfies Connection;
  });

  const call = Effect.fn("DocsCloudImport.call")(function* <S extends Schema.Top>(
    conn: Connection,
    method: "GET" | "POST" | "PATCH",
    path: string,
    schema: S,
    body?: unknown,
  ) {
    const request = HttpClientRequest.make(method)(`${conn.origin}${path}`).pipe(
      HttpClientRequest.setHeader("Authorization", conn.authorization),
      HttpClientRequest.setHeader("Accept", "application/json"),
      body === undefined ? (r) => r : HttpClientRequest.bodyJsonUnsafe(body),
    );
    const response = yield* http.execute(request).pipe(
      Effect.timeout("20 seconds"),
      Effect.mapError(
        (cause) => new DocsCloudError({ reason: "unreachable", detail: String(cause) }),
      ),
    );
    const json = yield* response.json.pipe(Effect.orElseSucceed(() => ({})));
    if (response.status === 401 || response.status === 403) {
      return yield* new DocsCloudError({ reason: "unauthorized" });
    }
    if (response.status < 200 || response.status >= 300) {
      const code = decodeErrorBody(json).pipe(
        Option.flatMap((value) => Option.fromNullishOr(value.error)),
        Option.getOrElse(() => `HTTP ${response.status}`),
      );
      return yield* new DocsCloudError({ reason: "failed", detail: code });
    }
    return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
      Effect.mapError(
        () => new DocsCloudError({ reason: "failed", detail: "unexpected response" }),
      ),
    );
  });

  const t3Project = (projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      Effect.mapError(() => new DocsCloudError({ reason: "not_found" })),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new DocsCloudError({ reason: "not_found" })),
          onSome: Effect.succeed,
        }),
      ),
    );

  // The shell's identity comes from an enrichment cache that may still be
  // cold; the resolver answers from git (and its own cache).
  const keyOf = Effect.fn("DocsCloudImport.keyOf")(function* (project: {
    readonly title: string;
    readonly workspaceRoot: string;
    readonly repositoryIdentity?: RepositoryIdentity | null | undefined;
  }) {
    const resolved = yield* repositories.resolve(project.workspaceRoot);
    return docsCloudProjectKey({
      title: project.title,
      repositoryIdentity: resolved ?? project.repositoryIdentity ?? null,
    });
  });

  const upsert = Effect.fn("DocsCloudImport.upsert")(function* (
    conn: Connection,
    entries: ReadonlyArray<{ readonly key: string; readonly name: string }>,
  ) {
    const synced = yield* call(conn, "POST", "/api/projects/sync", SyncedProjects, {
      projects: entries,
    });
    return synced.projects.map((project): DocsCloudProject => ({
      ...project,
      url: `${conn.origin}/`,
    }));
  });

  const resolveProject = Effect.fn("DocsCloudImport.resolveProject")(function* (
    conn: Connection,
    projectId: ProjectId,
  ) {
    const t3 = yield* t3Project(projectId);
    const [project] = yield* upsert(conn, [{ key: yield* keyOf(t3), name: t3.title.trim() }]);
    if (!project)
      return yield* new DocsCloudError({ reason: "failed", detail: "unexpected response" });
    return project;
  });

  const project: DocsCloudImport["Service"]["project"] = Effect.fn("DocsCloudImport.project")(
    function* (input) {
      return yield* resolveProject(yield* connection, input.projectId);
    },
  );

  const syncProjects: DocsCloudImport["Service"]["syncProjects"] = Effect.gen(function* () {
    const conn = yield* connection;
    const shells = yield* projects
      .listShells()
      .pipe(Effect.mapError(() => new DocsCloudError({ reason: "persistence" })));
    const entries = yield* Effect.forEach(
      shells,
      (shell) => Effect.map(keyOf(shell), (key) => ({ key, name: shell.title.trim() })),
      { concurrency: 4 },
    );
    return yield* upsert(conn, entries);
  }).pipe(Effect.withSpan("DocsCloudImport.syncProjects"));

  const docUrl = (origin: string, docId: string) => `${origin}/d/${docId}`;
  const toRecord = (origin: string, row: ImportRow): DocsCloudImportRecord => ({
    docPath: row.doc_path,
    docId: row.doc_id,
    url: docUrl(origin, row.doc_id),
    importedAt: row.imported_at,
  });

  const readImports = (origin: string, projectId: ProjectId) =>
    persistence(
      sql<ImportRow>`
        SELECT doc_path, doc_id, tab_id, imported_at FROM docs_cloud_imports
        WHERE origin = ${origin} AND project_id = ${projectId}
        ORDER BY doc_path
      `,
    );

  const listDocPaths = (cwd: string) =>
    workspaceDocs.list({ cwd, folder: DOCS_ROOT }).pipe(
      Effect.map((listed) => listed.docs),
      Effect.mapError((error) => new DocsCloudError({ reason: "failed", detail: error.message })),
    );

  const listImports: DocsCloudImport["Service"]["listImports"] = Effect.fn(
    "DocsCloudImport.listImports",
  )(function* (input) {
    const docs = yield* listDocPaths(input.cwd);
    const server = yield* entry;
    const origin = server ? originOf(server.transport.url) : null;
    if (origin === null) return { docs, imports: [] };
    const rows = yield* readImports(origin, input.projectId);
    return { docs, imports: rows.map((row) => toRecord(origin, row)) };
  });

  const importComments = Effect.fn("DocsCloudImport.importComments")(function* (
    conn: Connection,
    tabId: string,
    open: ReadonlyArray<DocComment>,
  ) {
    let imported = 0;
    const skipped: Array<DocsCloudSkippedComment> = [];
    for (const comment of open) {
      const outcome = yield* Effect.gen(function* () {
        const created = yield* call(conn, "POST", `/api/tabs/${tabId}/comments`, CreatedComment, {
          quote: comment.quote,
          prefix: comment.prefix,
          suffix: comment.suffix,
          body: comment.body,
          requireAnchor: true,
        });
        for (const reply of comment.replies) {
          if (reply.body.trim() === "") continue;
          yield* call(conn, "POST", `/api/comments/${created.comment.id}/replies`, CreatedComment, {
            body: reply.body,
          });
        }
      }).pipe(
        Effect.as(null),
        Effect.catch((error) =>
          Effect.succeed<DocsCloudSkippedComment["reason"]>(
            error.detail === "anchor_not_found" ? "text_not_found" : "failed",
          ),
        ),
      );
      if (outcome === null) imported += 1;
      else skipped.push({ commentId: comment.id, quote: comment.quote, reason: outcome });
    }
    return { imported, skipped };
  });

  const writeFirstTab = (
    conn: Connection,
    tab: { id: string; version: number },
    markdown: string,
  ) =>
    call(conn, "PATCH", `/api/tabs/${tab.id}`, WrittenTab, {
      baseVersion: tab.version,
      markdown,
    });

  const importOne = Effect.fn("DocsCloudImport.importOne")(function* (input: {
    readonly conn: Connection;
    readonly projectId: ProjectId;
    readonly cloudProjectId: string;
    readonly cwd: string;
    readonly docPath: string;
    readonly existing: ImportRow | undefined;
    readonly update: boolean;
    readonly openComments: ReadonlyArray<DocComment>;
  }): Effect.fn.Return<
    DocsCloudImportFileResult,
    DocsCloudError | WorkspaceDocs.WorkspaceDocsError
  > {
    const { conn, existing } = input;
    const empty = { error: null, commentsImported: 0, commentsSkipped: [] };
    if (existing && !input.update) {
      return {
        ...empty,
        docPath: input.docPath,
        status: "skipped",
        doc: toRecord(conn.origin, existing),
      } as const;
    }
    const file = yield* workspaceDocs.read({ cwd: input.cwd, docPath: input.docPath });
    if (file.truncated) {
      return {
        ...empty,
        docPath: file.docPath,
        status: "failed",
        doc: null,
        error: "This doc is too large to import.",
      } as const;
    }

    if (existing) {
      // A doc deleted in Docs Cloud since its import is imported again below.
      const current = yield* call(conn, "GET", `/api/docs/${existing.doc_id}`, DocWithTabs).pipe(
        Effect.map(Option.some),
        Effect.catchIf(
          (error) => error.reason === "failed" && error.detail === "not_found",
          () => Effect.succeed(Option.none()),
        ),
      );
      if (Option.isSome(current)) {
        const tab =
          current.value.tabs.find((candidate) => candidate.id === existing.tab_id) ??
          current.value.tabs[0];
        if (tab) {
          yield* writeFirstTab(conn, tab, file.markdown);
          return {
            ...empty,
            docPath: file.docPath,
            status: "updated",
            doc: toRecord(conn.origin, existing),
          } as const;
        }
      }
    }

    const created = yield* call(conn, "POST", "/api/docs", DocWithTabs, {
      projectId: input.cloudProjectId,
      title: importTitle(file.docPath, file.markdown),
    });
    const tab = created.tabs[0];
    if (!tab) return yield* new DocsCloudError({ reason: "failed", detail: "doc has no tab" });
    if (file.markdown !== "") yield* writeFirstTab(conn, tab, file.markdown);
    const importedAt = DateTime.formatIso(yield* DateTime.now);
    // Recorded before the comments, so a failure there can never lead to a duplicate doc.
    yield* persistence(sql`
        INSERT INTO docs_cloud_imports (origin, project_id, doc_path, doc_id, tab_id, imported_at)
        VALUES (${conn.origin}, ${input.projectId}, ${file.docPath}, ${created.doc.id}, ${tab.id}, ${importedAt})
        ON CONFLICT (origin, project_id, doc_path)
        DO UPDATE SET doc_id = excluded.doc_id, tab_id = excluded.tab_id, imported_at = excluded.imported_at
      `);
    const result = yield* importComments(
      conn,
      tab.id,
      input.openComments.filter((comment) => comment.docPath === file.docPath),
    );
    return {
      docPath: file.docPath,
      status: "imported",
      doc: {
        docPath: file.docPath,
        docId: created.doc.id,
        url: docUrl(conn.origin, created.doc.id),
        importedAt,
      },
      error: null,
      commentsImported: result.imported,
      commentsSkipped: result.skipped,
    } as const;
  });

  const importDocs: DocsCloudImport["Service"]["importDocs"] = Effect.fn(
    "DocsCloudImport.importDocs",
  )(function* (input) {
    const conn = yield* connection;
    const cloudProject = yield* resolveProject(conn, input.projectId);
    const docPaths = input.docPaths ?? (yield* listDocPaths(input.cwd)).map((doc) => doc.docPath);
    const existing = new Map(
      (yield* readImports(conn.origin, input.projectId)).map((row) => [row.doc_path, row]),
    );
    const openComments = yield* comments
      .listForProject({ projectId: input.projectId, includeResolved: false })
      .pipe(Effect.mapError(() => new DocsCloudError({ reason: "persistence" })));

    const results: Array<DocsCloudImportFileResult> = [];
    for (const docPath of docPaths) {
      results.push(
        yield* importOne({
          conn,
          projectId: input.projectId,
          cloudProjectId: cloudProject.id,
          cwd: input.cwd,
          docPath,
          existing: existing.get(docPath),
          update: input.update ?? false,
          openComments,
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              docPath,
              status: "failed",
              doc: null,
              error: error.message,
              commentsImported: 0,
              commentsSkipped: [],
            } as const),
          ),
        ),
      );
    }
    return { project: cloudProject, results };
  });

  return DocsCloudImport.of({ project, syncProjects, listImports, importDocs });
});

export const layer = Layer.effect(DocsCloudImport, make);

/** Bursts of project edits, and a Docs Cloud sign-in, settle into one sync. */
const SYNC_DEBOUNCE = Duration.seconds(2);

/**
 * Syncs this environment's projects into Docs Cloud once the server is ready,
 * then whenever a project is created or renamed or Docs Cloud is connected.
 * Best effort: a failure is logged and the next trigger tries again; nothing
 * waits on it.
 */
export const layerProjectSync = Layer.effectDiscard(
  Effect.gen(function* () {
    const cloud = yield* DocsCloudImport;
    const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
    const events = yield* OrchestrationEventStore.OrchestrationEventStore;
    const connection = yield* DocsCloudConnection.DocsCloudConnection;

    const sync = cloud.syncProjects.pipe(
      Effect.tap((synced) =>
        Effect.logDebug("Docs Cloud projects synced", { count: synced.length }),
      ),
      Effect.catch((error) =>
        error.reason === "not_configured"
          ? Effect.void
          : Effect.logWarning("Docs Cloud project sync failed", {
              reason: error.reason,
              detail: error.detail,
            }),
      ),
    );

    yield* Effect.gen(function* () {
      yield* startup.awaitCommandReady;
      const afterSequence = yield* events.latestApplicationSequence;
      yield* sync;
      const projectChanges = events
        .streamApplicationEvents({ afterSequence })
        .pipe(
          Stream.filter(
            (event) =>
              "aggregateKind" in event &&
              event.aggregateKind === "project" &&
              event.type !== "project.deleted",
          ),
        );
      const connected = connection.changes.pipe(Stream.filter((isConnected) => isConnected));
      yield* Stream.merge(projectChanges, connected).pipe(
        Stream.debounce(SYNC_DEBOUNCE),
        Stream.runForEach(() => sync),
      );
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Docs Cloud project sync stopped", { cause })),
      Effect.forkScoped,
    );
  }),
);
