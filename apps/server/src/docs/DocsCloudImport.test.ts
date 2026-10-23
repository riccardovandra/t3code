import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import { type McpServerEntry, ProjectId, type Project as ProjectRecord } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

import * as McpServerRegistry from "../mcpHub/McpServerRegistry.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as WorkspaceDocs from "../workspace/WorkspaceDocs.ts";
import * as DocCommentsService from "./DocCommentsService.ts";
import * as DocsCloudImport from "./DocsCloudImport.ts";

const projectId = ProjectId.make("project-import");
const user = { kind: "user", threadId: null } as const;

interface FakeTab {
  id: string;
  version: number;
  markdown: string;
}

/** An in-memory Docs Cloud that answers the REST routes the importer uses. */
const makeDocsCloud = (options: { projects?: Array<{ id: string; name: string }> } = {}) => {
  const state = {
    mode: "ok" as "ok" | "unreachable" | "unauthorized",
    projects: options.projects ?? [],
    docs: new Map<string, { projectId: string; title: string; tabs: Array<FakeTab> }>(),
    comments: [] as Array<{ id: string; tabId: string; parentId: string | null; body: string }>,
    requests: [] as Array<string>,
  };
  let nextId = 0;
  const id = (prefix: string) => `${prefix}-${++nextId}`;
  const tabById = (tabId: string) =>
    [...state.docs.values()].flatMap((doc) => doc.tabs).find((tab) => tab.id === tabId);

  const respond = (request: HttpClientRequest.HttpClientRequest, status: number, body: unknown) =>
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

  const route = (request: HttpClientRequest.HttpClientRequest) => {
    const { pathname } = new URL(request.url);
    const body =
      request.body._tag === "Uint8Array"
        ? (JSON.parse(new TextDecoder().decode(request.body.body)) as Record<string, unknown>)
        : {};
    state.requests.push(`${request.method} ${pathname}`);
    if (request.headers["authorization"] !== "Bearer dct_good" || state.mode === "unauthorized") {
      return respond(request, 401, { error: "unauthorized" });
    }
    if (pathname === "/api/library") {
      return respond(request, 200, { projects: state.projects.map((p) => ({ ...p, docs: [] })) });
    }
    if (pathname === "/api/projects") {
      const project = { id: id("project"), name: String(body.name) };
      state.projects.push(project);
      return respond(request, 201, { project });
    }
    if (pathname === "/api/docs" && request.method === "POST") {
      const docId = id("doc");
      const tab = { id: id("tab"), version: 1, markdown: "" };
      state.docs.set(docId, {
        projectId: String(body.projectId),
        title: String(body.title),
        tabs: [tab],
      });
      return respond(request, 201, { doc: { id: docId }, tabs: [tab] });
    }
    const docMatch = /^\/api\/docs\/([^/]+)$/.exec(pathname);
    if (docMatch && request.method === "GET") {
      const doc = state.docs.get(docMatch[1]!);
      return doc
        ? respond(request, 200, { doc: { id: docMatch[1] }, tabs: doc.tabs })
        : respond(request, 404, { error: "not_found" });
    }
    const tabMatch = /^\/api\/tabs\/([^/]+)(\/comments)?$/.exec(pathname);
    if (tabMatch) {
      const tab = tabById(tabMatch[1]!);
      if (!tab) return respond(request, 404, { error: "not_found" });
      if (!tabMatch[2]) {
        if (body.baseVersion !== tab.version) return respond(request, 409, { error: "conflict" });
        tab.markdown = String(body.markdown);
        tab.version += 1;
        return respond(request, 200, { tab });
      }
      if (body.requireAnchor === true && !tab.markdown.includes(String(body.quote))) {
        return respond(request, 409, { error: "anchor_not_found" });
      }
      const comment = { id: id("comment"), tabId: tab.id, parentId: null, body: String(body.body) };
      state.comments.push(comment);
      return respond(request, 201, { kind: "created", comment });
    }
    const replyMatch = /^\/api\/comments\/([^/]+)\/replies$/.exec(pathname);
    if (replyMatch) {
      const comment = {
        id: id("comment"),
        tabId: "",
        parentId: replyMatch[1]!,
        body: String(body.body),
      };
      state.comments.push(comment);
      return respond(request, 201, { kind: "created", comment });
    }
    return respond(request, 404, { error: "not_found" });
  };

  const client = HttpClient.make((request) =>
    state.mode === "unreachable"
      ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          }),
        )
      : Effect.sync(() => route(request)),
  );
  return { state, client };
};

const files = new Map<string, string>([
  ["docs/plan.md", "# Launch plan\n\nThe beta ships **Friday**.\n"],
  ["docs/notes.md", "Loose notes without a heading.\n"],
]);

const makeLayer = (
  docsCloud: ReturnType<typeof makeDocsCloud>,
  options: { title?: string; token?: string; configured?: boolean } = {},
) => {
  const server = {
    id: "server-docs-cloud",
    name: "docs-cloud",
    enabled: true,
    transport: { type: "http", url: "https://docs.example.test/mcp" },
    auth: { type: "header", header: "Authorization" },
  } as unknown as McpServerEntry;
  return DocsCloudImport.layer.pipe(
    Layer.provideMerge(DocCommentsService.layer),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, docsCloud.client)),
    Layer.provide(
      Layer.mock(McpServerRegistry.McpServerRegistry)({
        list: Effect.succeed({ servers: options.configured === false ? [] : [server] }),
        credentials: () =>
          Effect.succeed({
            headers: { Authorization: `Bearer ${options.token ?? "dct_good"}` },
            env: {},
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: () =>
          Effect.succeedSome({
            title: options.title ?? "Uplifted Site",
            workspaceRoot: "/checkout",
          } as ProjectRecord),
      }),
    ),
    Layer.provide(
      Layer.mock(WorkspaceDocs.WorkspaceDocs)({
        list: () =>
          Effect.succeed({
            docs: [...files.keys()].map((docPath) => ({ docPath, title: docPath })),
            truncated: false,
          }),
        read: ({ docPath }) => {
          const markdown = files.get(docPath);
          return markdown === undefined
            ? Effect.fail(
                new WorkspaceDocs.WorkspaceDocsError({ reason: "not_found", path: docPath }),
              )
            : Effect.succeed({ docPath, title: docPath, markdown, truncated: false });
        },
      }),
    ),
    Layer.provideMerge(
      Layer.effectDiscard(runMigrations()).pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
      ),
    ),
    Layer.provide(NodeCrypto.layer),
  );
};

const importDocs = (input: { docPaths?: Array<string>; update?: boolean } = {}) =>
  Effect.flatMap(DocsCloudImport.DocsCloudImport, (cloud) =>
    cloud.importDocs({ projectId, cwd: "/checkout", ...input }),
  );

describe("DocsCloudImport", () => {
  it("titles a doc from its first heading, else its file name", () => {
    assert.strictEqual(
      DocsCloudImport.importTitle("docs/a.md", "intro\n# Real title #\n"),
      "Real title",
    );
    assert.strictEqual(
      DocsCloudImport.importTitle("docs/launch-plan.md", "no heading"),
      "launch plan",
    );
  });

  it.effect("uses the same-named project ignoring case and spacing, creating it only once", () => {
    const docsCloud = makeDocsCloud({ projects: [{ id: "existing", name: "  uplifted   SITE " }] });
    return Effect.gen(function* () {
      const cloud = yield* DocsCloudImport.DocsCloudImport;
      const project = yield* cloud.project({ projectId });
      assert.strictEqual(project.id, "existing");
      assert.isFalse(docsCloud.state.requests.includes("POST /api/projects"));
    }).pipe(Effect.provide(makeLayer(docsCloud)));
  });

  it.effect("creates the project on first use and finds it afterwards", () => {
    const docsCloud = makeDocsCloud();
    return Effect.gen(function* () {
      const cloud = yield* DocsCloudImport.DocsCloudImport;
      const first = yield* cloud.project({ projectId });
      const second = yield* cloud.project({ projectId });
      assert.strictEqual(first.name, "Client Work");
      assert.strictEqual(second.id, first.id);
      assert.strictEqual(
        docsCloud.state.requests.filter((request) => request === "POST /api/projects").length,
        1,
      );
    }).pipe(Effect.provide(makeLayer(docsCloud, { title: " Client Work " })));
  });

  it.effect("imports each doc once, recording it, and updates only when asked", () => {
    const docsCloud = makeDocsCloud();
    return Effect.gen(function* () {
      const first = yield* importDocs();
      assert.deepStrictEqual(
        first.results.map((result) => [result.docPath, result.status]),
        [
          ["docs/plan.md", "imported"],
          ["docs/notes.md", "imported"],
        ],
      );
      const titles = [...docsCloud.state.docs.values()].map((doc) => doc.title).toSorted();
      assert.deepStrictEqual(titles, ["Launch plan", "notes"]);
      const plan = first.results[0]!.doc!;
      assert.strictEqual(plan.url, `https://docs.example.test/d/${plan.docId}`);
      assert.strictEqual(
        docsCloud.state.docs.get(plan.docId)!.tabs[0]!.markdown,
        files.get("docs/plan.md"),
      );

      const again = yield* importDocs();
      assert.deepStrictEqual(
        again.results.map((result) => [result.status, result.doc?.docId]),
        first.results.map((result) => ["skipped", result.doc?.docId]),
      );
      assert.strictEqual(docsCloud.state.docs.size, 2);

      const cloud = yield* DocsCloudImport.DocsCloudImport;
      const { imports } = yield* cloud.listImports({ projectId });
      assert.deepStrictEqual(imports.map((record) => record.docPath).toSorted(), [
        "docs/notes.md",
        "docs/plan.md",
      ]);

      docsCloud.state.docs.get(plan.docId)!.tabs[0]!.markdown = "edited in Docs Cloud";
      const updated = yield* importDocs({ docPaths: ["docs/plan.md"], update: true });
      assert.strictEqual(updated.results[0]!.status, "updated");
      assert.strictEqual(updated.results[0]!.doc!.docId, plan.docId);
      assert.strictEqual(
        docsCloud.state.docs.get(plan.docId)!.tabs[0]!.markdown,
        files.get("docs/plan.md"),
      );

      // A doc deleted in Docs Cloud is imported afresh rather than failing.
      docsCloud.state.docs.delete(plan.docId);
      const reimported = yield* importDocs({ docPaths: ["docs/plan.md"], update: true });
      assert.strictEqual(reimported.results[0]!.status, "imported");
      assert.notStrictEqual(reimported.results[0]!.doc!.docId, plan.docId);
    }).pipe(Effect.provide(makeLayer(docsCloud)));
  });

  it.effect("re-creates open comments with replies and skips ones whose text is gone", () => {
    const docsCloud = makeDocsCloud();
    return Effect.gen(function* () {
      const comments = yield* DocCommentsService.DocCommentsService;
      const base = {
        projectId,
        docPath: "docs/plan.md",
        prefix: "ships ",
        suffix: ".",
        author: user,
      };
      const anchored = (yield* comments.create({ ...base, quote: "Friday", body: "Why Friday?" }))
        .comment!;
      yield* comments.reply({ projectId, commentId: anchored.id, body: "Launch", author: user });
      const gone = (yield* comments.create({ ...base, quote: "Monday", body: "Moved?" })).comment!;
      const resolved = (yield* comments.create({ ...base, quote: "beta", body: "Done" })).comment!;
      yield* comments.setResolved({ projectId, commentId: resolved.id, resolved: true });

      const result = yield* importDocs({ docPaths: ["docs/plan.md"] });
      const plan = result.results[0]!;
      assert.strictEqual(plan.commentsImported, 1);
      assert.deepStrictEqual(plan.commentsSkipped, [
        { commentId: gone.id, quote: "Monday", reason: "text_not_found" },
      ]);
      assert.deepStrictEqual(
        docsCloud.state.comments.map((comment) => [comment.body, comment.parentId !== null]),
        [
          ["Why Friday?", false],
          ["Launch", true],
        ],
      );
      // The old comments stay where they were.
      assert.strictEqual(
        (yield* comments.list({ projectId, docPath: "docs/plan.md" })).comments.length,
        3,
      );
    }).pipe(Effect.provide(makeLayer(docsCloud)));
  });

  it.effect("reports a missing file per doc and keeps importing the rest", () => {
    const docsCloud = makeDocsCloud();
    return Effect.gen(function* () {
      const result = yield* importDocs({ docPaths: ["docs/missing.md", "docs/notes.md"] });
      assert.deepStrictEqual(
        result.results.map((entry) => entry.status),
        ["failed", "imported"],
      );
      assert.include(result.results[0]!.error, "No doc exists");
    }).pipe(Effect.provide(makeLayer(docsCloud)));
  });

  it.effect(
    "fails the whole import when Docs Cloud is unreachable, refuses the token, or is not set up",
    () =>
      Effect.gen(function* () {
        const unreachable = makeDocsCloud();
        unreachable.state.mode = "unreachable";
        const offline = yield* importDocs().pipe(
          Effect.flip,
          Effect.provide(makeLayer(unreachable)),
        );
        assert.strictEqual(offline.reason, "unreachable");

        const rejected = yield* importDocs().pipe(
          Effect.flip,
          Effect.provide(makeLayer(makeDocsCloud(), { token: "dct_revoked" })),
        );
        assert.strictEqual(rejected.reason, "unauthorized");

        const missing = yield* importDocs().pipe(
          Effect.flip,
          Effect.provide(makeLayer(makeDocsCloud(), { configured: false })),
        );
        assert.strictEqual(missing.reason, "not_configured");
        const listed = yield* Effect.flatMap(DocsCloudImport.DocsCloudImport, (cloud) =>
          cloud.listImports({ projectId }),
        ).pipe(Effect.provide(makeLayer(makeDocsCloud(), { configured: false })));
        assert.deepStrictEqual(listed.imports, []);
      }),
  );
});
