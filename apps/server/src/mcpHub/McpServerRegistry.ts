/**
 * User-configured MCP servers that T3 Code forwards to. The list lives in its
 * own file beside settings.json rather than in the settings document, so the
 * generic settings patch cannot skip name checks or orphan secrets. Secret
 * values live only in ServerSecretStore and never appear in returned configs.
 */
import {
  type McpSecretInput,
  McpServerConfig,
  type McpServerEntry,
  McpServerError,
  McpServerId,
  type McpServerListResult,
  type McpServerRemoveInput,
  type McpServerSetEnabledInput,
  type McpServerStatus,
  type McpServerUpsertInput,
  type ProjectId,
  RESERVED_MCP_SERVER_NAMES,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";

const StoredServers = Schema.fromJsonString(
  Schema.Struct({ servers: Schema.Array(McpServerConfig) }),
);
const decodeStored = Schema.decodeUnknownEffect(StoredServers);
const encodeStored = Schema.encodeEffect(StoredServers);

const headerSecretName = (id: McpServerId) => `mcp-server-${id}-header`;
const envSecretName = (id: McpServerId, key: string) => `mcp-server-${id}-env-${key}`;
export const oauthTokensSecretName = (id: McpServerId) => `mcp-server-${id}-oauth-tokens`;
export const oauthRegistrationSecretName = (id: McpServerId) =>
  `mcp-server-${id}-oauth-registration`;
export const oauthClientSecretName = (id: McpServerId) => `mcp-server-${id}-oauth-client-secret`;

/** What a sign-in produced. Signing out, or changing who the client is, deletes these. */
const oauthSessionSecretNames = (id: McpServerId) => [
  oauthTokensSecretName(id),
  oauthRegistrationSecretName(id),
];

const secretNames = (config: McpServerConfig): ReadonlyArray<string> => [
  ...(config.auth.type === "header" ? [headerSecretName(config.id)] : []),
  ...(config.auth.type === "oauth"
    ? [
        ...oauthSessionSecretNames(config.id),
        ...(config.auth.client?.hasClientSecret ? [oauthClientSecretName(config.id)] : []),
      ]
    : []),
  ...(config.transport.type === "stdio"
    ? config.transport.secretEnv.map((key) => envSecretName(config.id, key))
    : []),
];

/** Tokens from one server or client are useless, and possibly unsafe, for another. */
const oauthIdentity = (config: McpServerConfig) =>
  config.auth.type === "oauth" && config.transport.type === "http"
    ? `${config.transport.url} ${config.auth.client?.clientId ?? ""}`
    : undefined;

/** Values the forwarding client adds to the upstream connection. */
interface McpServerCredentials {
  readonly headers: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
}

export class McpServerRegistry extends Context.Service<
  McpServerRegistry,
  {
    readonly list: Effect.Effect<McpServerListResult, McpServerError>;
    readonly get: (id: McpServerId) => Effect.Effect<McpServerConfig | undefined, McpServerError>;
    /** `projectId` scopes secretRef consumption to the calling thread's project. */
    readonly upsert: (
      input: McpServerUpsertInput,
      options?: { readonly projectId?: ProjectId },
    ) => Effect.Effect<McpServerEntry, McpServerError, SecretRequests.SecretRequests>;
    readonly remove: (input: McpServerRemoveInput) => Effect.Effect<void, McpServerError>;
    readonly setEnabled: (
      input: McpServerSetEnabledInput,
    ) => Effect.Effect<McpServerEntry, McpServerError>;
    readonly credentials: (
      config: McpServerConfig,
    ) => Effect.Effect<McpServerCredentials, McpServerError>;
    readonly reportStatus: (id: McpServerId, status: McpServerStatus) => Effect.Effect<void>;
    /** Drops the server's client and reported status after its stored sign-in changed. */
    readonly resetConnection: (id: McpServerId) => Effect.Effect<void>;
    /** Emits the id of every server whose config changed or was removed. */
    readonly changes: Stream.Stream<McpServerId>;
    /** The list now, then again whenever a config, sign-in or reported status changes. */
    readonly subscribeList: Stream.Stream<McpServerListResult, McpServerError>;
  }
>()("t3/mcpHub/McpServerRegistry") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const { settingsPath } = yield* ServerConfig.ServerConfig;
  const filePath = path.join(path.dirname(settingsPath), "mcp-servers.json");

  const lock = yield* Semaphore.make(1);
  const cache = yield* Ref.make<ReadonlyArray<McpServerConfig> | undefined>(undefined);
  const statuses = yield* Ref.make<ReadonlyMap<McpServerId, McpServerStatus>>(new Map());
  const changed = yield* PubSub.unbounded<McpServerId>();
  // Subscribers re-read the whole list, so one pending signal covers any burst.
  const listChanged = yield* PubSub.sliding<void>(1);

  // A file that fails to load is not cached, so a later save cannot replace
  // servers the user still has on disk with an empty list.
  const load = Effect.gen(function* () {
    const cached = yield* Ref.get(cache);
    if (cached !== undefined) return cached;
    const exists = yield* fileSystem.exists(filePath);
    const servers = exists
      ? (yield* fileSystem.readFileString(filePath).pipe(Effect.flatMap(decodeStored))).servers
      : [];
    yield* Ref.set(cache, servers);
    return servers;
  }).pipe(Effect.mapError((cause) => new McpServerError({ reason: "read_failed", cause })));

  const save = (servers: ReadonlyArray<McpServerConfig>) =>
    encodeStored({ servers }).pipe(
      Effect.flatMap((contents) =>
        writeFileStringAtomically({ filePath, contents: `${contents}\n` }),
      ),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.andThen(Ref.set(cache, servers)),
      Effect.mapError((cause) => new McpServerError({ reason: "write_failed", cause })),
    );

  const secretFailed = (cause: unknown) => new McpServerError({ reason: "secret_failed", cause });

  // An unreadable token store reads as signed out: the user can act on that.
  const hasTokens = (id: McpServerId) =>
    secrets.get(oauthTokensSecretName(id)).pipe(
      Effect.map(Option.isSome),
      Effect.orElseSucceed(() => false),
    );

  const statusOf = (config: McpServerConfig) =>
    Effect.gen(function* () {
      if (!config.enabled) return { state: "disabled" } as const;
      if (config.auth.type === "oauth" && !(yield* hasTokens(config.id))) {
        return { state: "needs-sign-in" } as const;
      }
      return (yield* Ref.get(statuses)).get(config.id) ?? ({ state: "idle" } as const);
    });

  const toEntry = (config: McpServerConfig) =>
    statusOf(config).pipe(Effect.map((status): McpServerEntry => ({ ...config, status })));

  const markChanged = (id: McpServerId) =>
    Ref.update(statuses, (known) => {
      const next = new Map(known);
      next.delete(id);
      return next;
    }).pipe(
      Effect.andThen(PubSub.publish(changed, id)),
      Effect.andThen(PubSub.publish(listChanged, undefined)),
    );

  const list: McpServerRegistry["Service"]["list"] = Effect.gen(function* () {
    const servers = yield* load;
    return { servers: yield* Effect.forEach(servers, toEntry) };
  }).pipe(Effect.withSpan("McpServerRegistry.list"));

  const get: McpServerRegistry["Service"]["get"] = (id) =>
    load.pipe(Effect.map((servers) => servers.find((server) => server.id === id)));

  /** Resolves one secret input to a new value, or undefined to keep the stored one. */
  const resolveSecret = (input: McpSecretInput, projectId: ProjectId | undefined) =>
    Effect.gen(function* () {
      if (input.secretRef !== undefined) {
        if (projectId === undefined) {
          return yield* new McpServerError({ reason: "secret_ref_unscoped" });
        }
        // Required per call rather than at construction: SecretRequests sits above
        // the provider sessions that read this registry, so a construction-time
        // dependency would be circular.
        const secretRequests = yield* SecretRequests.SecretRequests;
        return yield* secretRequests
          .consume({ ref: input.secretRef, projectId })
          .pipe(
            Effect.mapError((cause) => new McpServerError({ reason: "secret_ref_failed", cause })),
          );
      }
      return input.secret;
    });

  const upsert: McpServerRegistry["Service"]["upsert"] = (input, options) =>
    lock
      .withPermit(
        Effect.gen(function* () {
          const servers = yield* load;
          const existing =
            input.id === undefined ? undefined : servers.find((server) => server.id === input.id);
          if (input.id !== undefined && existing === undefined) {
            return yield* new McpServerError({ reason: "not_found" });
          }
          if (RESERVED_MCP_SERVER_NAMES.has(input.name)) {
            return yield* new McpServerError({ reason: "reserved_name" });
          }
          if (servers.some((server) => server.name === input.name && server.id !== input.id)) {
            return yield* new McpServerError({ reason: "duplicate_name" });
          }
          const auth = input.auth ?? { type: "none" as const };
          if (input.transport.type === "stdio" && auth.type !== "none") {
            return yield* new McpServerError({ reason: "auth_unsupported" });
          }

          const id =
            existing?.id ??
            McpServerId.make(
              yield* crypto.randomUUIDv4().pipe(
                Effect.orDie,
                Effect.map((uuid) => uuid.toLowerCase()),
              ),
            );
          const stored = new Set(existing === undefined ? [] : secretNames(existing));
          const writes = new Map<string, string>();
          const projectId = options?.projectId;
          const keepOrWrite = (name: string, input: McpSecretInput) =>
            resolveSecret(input, projectId).pipe(
              Effect.flatMap((value) => {
                if (value !== undefined) {
                  writes.set(name, value);
                  return Effect.void;
                }
                return stored.has(name)
                  ? Effect.void
                  : Effect.fail(new McpServerError({ reason: "secret_required" }));
              }),
            );

          if (auth.type === "header") yield* keepOrWrite(headerSecretName(id), auth);
          const oauthClient = auth.type === "oauth" ? auth.client : undefined;
          let hasClientSecret = false;
          if (oauthClient !== undefined) {
            const name = oauthClientSecretName(id);
            const value =
              oauthClient.clientSecret === undefined
                ? undefined
                : yield* resolveSecret(oauthClient.clientSecret, projectId);
            if (value !== undefined) writes.set(name, value);
            hasClientSecret = value !== undefined || stored.has(name);
          }
          const secretEnv =
            input.transport.type === "stdio" ? Object.entries(input.transport.secretEnv ?? {}) : [];
          for (const [key, secret] of secretEnv) {
            yield* keepOrWrite(envSecretName(id, key), secret);
          }

          const now = DateTime.formatIso(yield* DateTime.now);
          const config: McpServerConfig = {
            id,
            name: input.name,
            enabled: input.enabled ?? true,
            transport:
              input.transport.type === "http"
                ? { type: "http", url: input.transport.url }
                : {
                    type: "stdio",
                    command: input.transport.command,
                    args: input.transport.args ?? [],
                    env: input.transport.env ?? {},
                    secretEnv: secretEnv.map(([key]) => key),
                  },
            auth:
              auth.type === "header"
                ? { type: "header", header: auth.header }
                : auth.type === "oauth"
                  ? oauthClient === undefined
                    ? { type: "oauth" }
                    : {
                        type: "oauth",
                        client: {
                          clientId: oauthClient.clientId,
                          redirectUri: oauthClient.redirectUri,
                          hasClientSecret,
                        },
                      }
                  : auth,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };

          // New secrets land before the config that needs them, and stale ones
          // go only once nothing refers to them.
          yield* Effect.forEach(writes, ([name, value]) =>
            secrets.set(name, new TextEncoder().encode(value)).pipe(Effect.mapError(secretFailed)),
          );
          yield* save(
            existing === undefined
              ? [...servers, config]
              : servers.map((server) => (server.id === id ? config : server)),
          );
          const kept = new Set(secretNames(config));
          if (existing !== undefined && oauthIdentity(existing) !== oauthIdentity(config)) {
            for (const name of oauthSessionSecretNames(id)) kept.delete(name);
          }
          yield* Effect.forEach(
            [...stored].filter((name) => !kept.has(name)),
            (name) => secrets.remove(name).pipe(Effect.ignore({ log: true })),
          );
          yield* markChanged(id);
          return yield* toEntry(config);
        }),
      )
      .pipe(Effect.withSpan("McpServerRegistry.upsert"));

  const remove: McpServerRegistry["Service"]["remove"] = (input) =>
    lock
      .withPermit(
        Effect.gen(function* () {
          const servers = yield* load;
          const existing = servers.find((server) => server.id === input.id);
          if (existing === undefined) return yield* new McpServerError({ reason: "not_found" });
          yield* save(servers.filter((server) => server.id !== input.id));
          yield* Effect.forEach(secretNames(existing), (name) =>
            secrets.remove(name).pipe(Effect.ignore({ log: true })),
          );
          yield* markChanged(input.id);
        }),
      )
      .pipe(Effect.withSpan("McpServerRegistry.remove"));

  const setEnabled: McpServerRegistry["Service"]["setEnabled"] = (input) =>
    lock
      .withPermit(
        Effect.gen(function* () {
          const servers = yield* load;
          const existing = servers.find((server) => server.id === input.id);
          if (existing === undefined) return yield* new McpServerError({ reason: "not_found" });
          const config: McpServerConfig = {
            ...existing,
            enabled: input.enabled,
            updatedAt: DateTime.formatIso(yield* DateTime.now),
          };
          yield* save(servers.map((server) => (server.id === input.id ? config : server)));
          yield* markChanged(input.id);
          return yield* toEntry(config);
        }),
      )
      .pipe(Effect.withSpan("McpServerRegistry.setEnabled"));

  const readSecret = (name: string) =>
    secrets.get(name).pipe(
      Effect.mapError(secretFailed),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new McpServerError({ reason: "secret_required" })),
          onSome: (bytes) => Effect.succeed(new TextDecoder().decode(bytes)),
        }),
      ),
    );

  const credentials: McpServerRegistry["Service"]["credentials"] = (config) =>
    Effect.gen(function* () {
      const headers: Record<string, string> = {};
      const env: Record<string, string> = {};
      if (config.auth.type === "header") {
        headers[config.auth.header] = yield* readSecret(headerSecretName(config.id));
      }
      if (config.transport.type === "stdio") {
        for (const key of config.transport.secretEnv) {
          env[key] = yield* readSecret(envSecretName(config.id, key));
        }
      }
      return { headers, env };
    });

  // Status reports do not go through `changes`: that stream drops clients, and
  // every connect reports a status.
  const reportStatus: McpServerRegistry["Service"]["reportStatus"] = (id, status) =>
    Ref.modify(statuses, (known) => {
      const previous = known.get(id);
      const same =
        previous?.state === status.state &&
        (previous.state !== "error" ||
          (status.state === "error" && previous.message === status.message));
      return [!same, same ? known : new Map(known).set(id, status)] as const;
    }).pipe(
      Effect.flatMap((updated) => (updated ? PubSub.publish(listChanged, undefined) : Effect.void)),
      Effect.asVoid,
    );

  const subscribeList: McpServerRegistry["Service"]["subscribeList"] = Stream.unwrap(
    Effect.gen(function* () {
      // Subscribe before the snapshot so a change between the two is not lost.
      const subscription = yield* PubSub.subscribe(listChanged);
      return Stream.concat(
        Stream.fromEffect(list),
        Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list)),
      );
    }),
  );

  const resetConnection: McpServerRegistry["Service"]["resetConnection"] = markChanged;

  return McpServerRegistry.of({
    list,
    get,
    upsert,
    remove,
    setEnabled,
    credentials,
    reportStatus,
    resetConnection,
    changes: Stream.fromPubSub(changed),
    subscribeList,
  });
});

export const layer = Layer.effect(McpServerRegistry, make);
