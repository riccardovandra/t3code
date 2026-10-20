import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, SecretRef, SecretRequestError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as McpServerRegistry from "./McpServerRegistry.ts";

const projectId = ProjectId.make("project-1");
const goodRef = SecretRef.make("secret-ref:good");

const layerSecretRequests = Layer.mock(SecretRequests.SecretRequests)({
  consume: ({ ref, projectId: refProject }) =>
    ref === goodRef && refProject === projectId
      ? Effect.succeed("ref-secret-value")
      : Effect.fail(new SecretRequestError({ reason: "ref_unavailable" })),
});

const layerDependencies = Layer.mergeAll(ServerSecretStore.layer, layerSecretRequests).pipe(
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-server-registry-test-" }),
  ),
);

/** A fresh registry over the same files, as after a server restart. */
const startRegistry = Layer.build(Layer.fresh(McpServerRegistry.layer)).pipe(
  Effect.map((context) => Context.get(context, McpServerRegistry.McpServerRegistry)),
);

const reasonOf = <A, R>(effect: Effect.Effect<A, { readonly reason: string }, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

it.layer(NodeServices.layer)("McpServerRegistry", (it) => {
  it.effect("keeps servers across a restart and never returns secret values", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* startRegistry;
        const http = yield* registry.upsert({
          name: "notion",
          transport: { type: "http", url: "https://mcp.example.test/mcp" },
          auth: { type: "header", header: "Authorization", secret: "Bearer header-secret-value" },
        });
        const stdio = yield* registry.upsert({
          name: "local_tools",
          transport: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            env: { MODE: "test" },
            secretEnv: { API_KEY: { secret: "env-secret-value" } },
          },
        });
        assert.deepStrictEqual(http.status, { state: "idle" });
        assert.deepStrictEqual(http.auth, { type: "header", header: "Authorization" });

        const restarted = yield* startRegistry;
        const { servers } = yield* restarted.list;
        assert.deepStrictEqual(
          servers.map((server) => server.name),
          ["notion", "local_tools"],
        );
        const listed = JSON.stringify(servers);
        assert.notInclude(listed, "header-secret-value");
        assert.notInclude(listed, "env-secret-value");

        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { settingsPath } = yield* ServerConfig.ServerConfig;
        const onDisk = yield* fileSystem.readFileString(
          path.join(path.dirname(settingsPath), "mcp-servers.json"),
        );
        assert.notInclude(onDisk, "header-secret-value");
        assert.notInclude(onDisk, "env-secret-value");

        const stored = servers.find((server) => server.id === stdio.id)!;
        assert.deepStrictEqual(yield* restarted.credentials(stored), {
          headers: {},
          env: { API_KEY: "env-secret-value" },
        });
      }).pipe(Effect.provide(layerDependencies)),
    ),
  );

  it.effect("keeps an omitted secret on update and deletes secrets on remove", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* startRegistry;
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        const created = yield* registry.upsert({
          name: "gamma",
          transport: { type: "http", url: "https://gamma.example.test/mcp" },
          auth: { type: "header", header: "X-API-Key", secret: "first-secret" },
        });
        const updated = yield* registry.upsert({
          id: created.id,
          name: "gamma-renamed",
          transport: { type: "http", url: "https://gamma.example.test/v2/mcp" },
          auth: { type: "header", header: "X-API-Key" },
        });
        assert.strictEqual(updated.createdAt, created.createdAt);
        assert.deepStrictEqual(yield* registry.credentials(updated), {
          headers: { "X-API-Key": "first-secret" },
          env: {},
        });

        yield* registry.remove({ id: created.id });
        assert.deepStrictEqual((yield* registry.list).servers, []);
        assert.isTrue(Option.isNone(yield* secrets.get(`mcp-server-${created.id}-header`)));
        assert.strictEqual(yield* reasonOf(registry.remove({ id: created.id })), "not_found");
      }).pipe(Effect.provide(layerDependencies)),
    ),
  );

  it.effect("rejects reserved and duplicate names and a header without a secret", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* startRegistry;
        const http = { type: "http" as const, url: "https://mcp.example.test/mcp" };
        assert.strictEqual(
          yield* reasonOf(registry.upsert({ name: "t3-code", transport: http })),
          "reserved_name",
        );
        yield* registry.upsert({ name: "linear", transport: http });
        assert.strictEqual(
          yield* reasonOf(registry.upsert({ name: "linear", transport: http })),
          "duplicate_name",
        );
        assert.strictEqual(
          yield* reasonOf(
            registry.upsert({
              name: "missing-secret",
              transport: http,
              auth: { type: "header", header: "Authorization" },
            }),
          ),
          "secret_required",
        );
      }).pipe(Effect.provide(layerDependencies)),
    ),
  );

  it.effect("consumes a secretRef only for the calling thread's project", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* startRegistry;
        const input = {
          name: "fireflies",
          transport: { type: "http" as const, url: "https://fireflies.example.test/mcp" },
          auth: { type: "header" as const, header: "Authorization", secretRef: goodRef },
        };
        assert.strictEqual(yield* reasonOf(registry.upsert(input)), "secret_ref_unscoped");
        const saved = yield* registry.upsert(input, { projectId });
        assert.deepStrictEqual((yield* registry.credentials(saved)).headers, {
          Authorization: "ref-secret-value",
        });
      }).pipe(Effect.provide(layerDependencies)),
    ),
  );

  it.effect("reports disabled and OAuth servers without connecting", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* startRegistry;
        const oauth = yield* registry.upsert({
          name: "remote",
          transport: { type: "http", url: "https://remote.example.test/mcp" },
          auth: { type: "oauth" },
        });
        assert.deepStrictEqual(oauth.status, { state: "needs-sign-in" });
        const disabled = yield* registry.setEnabled({ id: oauth.id, enabled: false });
        assert.deepStrictEqual(disabled.status, { state: "disabled" });
      }).pipe(Effect.provide(layerDependencies)),
    ),
  );
});
