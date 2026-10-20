/**
 * One MCP client per configured server, shared by every thread. A client
 * connects on first use, is dropped when its connection fails so the next call
 * reconnects, and closes after sitting idle, which also stops a stdio server's
 * process. Upstream credentials are attached here and never leave the server.
 */
import { type McpServerConfig, type McpServerId, type McpServerStatus } from "@t3tools/contracts";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OAuthError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ErrorCode,
  type Implementation,
  McpError,
  type Result,
  ResultSchema,
  type ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { cast } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import packageJson from "../../package.json" with { type: "json" };
import * as McpServerOAuth from "./McpServerOAuth.ts";
import * as McpServerRegistry from "./McpServerRegistry.ts";

const UPSTREAM_FAILURE_MESSAGES = {
  not_found: "That MCP server does not exist.",
  disabled: "That MCP server is disabled.",
  needs_sign_in: "That MCP server needs sign-in in T3 Code before agents can use it.",
  rejected_credential: "That MCP server rejected the stored credential.",
  unavailable: "Could not connect to that MCP server.",
  upstream_error: "That MCP server returned an error.",
} as const;
type UpstreamFailureReason = keyof typeof UPSTREAM_FAILURE_MESSAGES;

export class McpUpstreamError extends Schema.TaggedError<McpUpstreamError>()("McpUpstreamError", {
  serverId: Schema.String,
  reason: Schema.Literals(Object.keys(UPSTREAM_FAILURE_MESSAGES) as Array<UpstreamFailureReason>),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return UPSTREAM_FAILURE_MESSAGES[this.reason];
  }
}

export interface McpUpstreamSession {
  readonly capabilities: ServerCapabilities;
  readonly serverInfo: Implementation | undefined;
  readonly instructions: string | undefined;
  /** Upstream JSON-RPC errors fail with reason `upstream_error` and the `McpError` as cause. */
  readonly request: (
    method: string,
    params: Record<string, unknown> | undefined,
  ) => Effect.Effect<Result, McpUpstreamError>;
}

export class McpUpstreamClients extends Context.Service<
  McpUpstreamClients,
  {
    readonly open: (id: McpServerId) => Effect.Effect<McpUpstreamSession, McpUpstreamError>;
  }
>()("t3/mcpHub/McpUpstreamClients") {}

/** Long tool calls, such as document generation, outlast the SDK's 60 second default. */
const REQUEST_TIMEOUT_MS = 10 * 60_000;
const IDLE_CLOSE_MS = 10 * 60_000;

interface Entry {
  readonly client: Deferred.Deferred<Client, McpUpstreamError>;
  connected: Client | undefined;
  lastUsedAt: number;
  active: number;
}

/**
 * An OAuth server whose tokens cannot be refreshed surfaces as the SDK's
 * UnauthorizedError or an OAuth error from the token endpoint.
 */
const authFailure = (
  config: McpServerConfig,
  cause: unknown,
): UpstreamFailureReason | undefined => {
  if (cause instanceof StreamableHTTPError && (cause.code === 401 || cause.code === 403)) {
    // A server that wants a credential nobody configured is asking for sign-in.
    return config.auth.type === "header" ? "rejected_credential" : "needs_sign_in";
  }
  if (
    cause instanceof UnauthorizedError ||
    (cause instanceof OAuthError && !(cause instanceof ServerError))
  ) {
    return "needs_sign_in";
  }
  return undefined;
};

const connectFailure = (config: McpServerConfig, cause: unknown): UpstreamFailureReason =>
  authFailure(config, cause) ?? "unavailable";

const statusFor = (reason: UpstreamFailureReason): McpServerStatus =>
  reason === "needs_sign_in"
    ? { state: "needs-sign-in" }
    : { state: "error", message: UPSTREAM_FAILURE_MESSAGES[reason] };

const make = Effect.gen(function* () {
  const registry = yield* McpServerRegistry.McpServerRegistry;
  const oauth = yield* McpServerOAuth.McpServerOAuth;
  const scope = yield* Effect.scope;
  const entries = new Map<McpServerId, Entry>();

  const closeClient = (client: Client) =>
    Effect.promise(() => client.close().catch(() => undefined));

  const drop = (id: McpServerId, entry: Entry) =>
    Effect.gen(function* () {
      if (entries.get(id) !== entry) return;
      entries.delete(id);
      if (entry.connected !== undefined) yield* closeClient(entry.connected);
    });

  const connect = (config: McpServerConfig) =>
    Effect.gen(function* () {
      const fail = (reason: UpstreamFailureReason, cause?: unknown) =>
        new McpUpstreamError({
          serverId: config.id,
          reason,
          ...(cause === undefined ? {} : { cause }),
        });
      const credentials = yield* registry
        .credentials(config)
        .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
      const authProvider = yield* oauth.forwardingProvider(config);
      if (config.auth.type === "oauth" && authProvider === undefined) {
        return yield* fail("needs_sign_in");
      }
      const transport =
        config.transport.type === "http"
          ? new StreamableHTTPClientTransport(new URL(config.transport.url), {
              requestInit: { headers: credentials.headers },
              ...(authProvider === undefined ? {} : { authProvider }),
            })
          : new StdioClientTransport({
              command: config.transport.command,
              args: [...config.transport.args],
              // Only the SDK's safe defaults, so the server's own secrets stay out of the child.
              env: { ...getDefaultEnvironment(), ...config.transport.env, ...credentials.env },
              stderr: "ignore",
            });
      const client = new Client({ name: "t3-code", version: packageJson.version });
      yield* Effect.tryPromise({
        // The SDK's transport classes predate exactOptionalPropertyTypes.
        try: () => client.connect(cast<typeof transport, Transport>(transport)),
        catch: (cause) => fail(connectFailure(config, cause), cause),
      }).pipe(Effect.tapError(() => closeClient(client)));
      return client;
    });

  const acquire = (config: McpServerConfig) =>
    Effect.gen(function* () {
      const existing = entries.get(config.id);
      if (existing !== undefined) return existing;
      const entry: Entry = {
        client: yield* Deferred.make<Client, McpUpstreamError>(),
        connected: undefined,
        lastUsedAt: yield* Clock.currentTimeMillis,
        active: 0,
      };
      entries.set(config.id, entry);
      // Connecting runs in the service's scope so a caller that gives up does
      // not leave the callers waiting with it on a connection nobody finishes.
      yield* connect(config).pipe(
        Effect.tap((client) => {
          // Dropped while connecting, such as by a config change.
          if (entries.get(config.id) !== entry) return closeClient(client);
          entry.connected = client;
          // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the SDK client only exposes this callback.
          client.onclose = () => {
            if (entries.get(config.id) === entry) entries.delete(config.id);
          };
          return registry.reportStatus(config.id, { state: "connected" });
        }),
        Effect.tapError((error) =>
          Effect.sync(() => entries.delete(config.id)).pipe(
            Effect.andThen(registry.reportStatus(config.id, statusFor(error.reason))),
          ),
        ),
        Effect.exit,
        Effect.flatMap((exit) => Deferred.done(entry.client, exit)),
        Effect.forkIn(scope),
      );
      return entry;
    });

  const open: McpUpstreamClients["Service"]["open"] = (id) =>
    Effect.gen(function* () {
      const fail = (reason: UpstreamFailureReason, cause?: unknown) =>
        new McpUpstreamError({ serverId: id, reason, ...(cause === undefined ? {} : { cause }) });
      const config = yield* registry
        .get(id)
        .pipe(Effect.mapError((cause) => fail("unavailable", cause)));
      if (config === undefined) return yield* fail("not_found");
      if (!config.enabled) return yield* fail("disabled");

      const entry = yield* acquire(config);
      const client = yield* Deferred.await(entry.client);
      entry.lastUsedAt = yield* Clock.currentTimeMillis;

      const request: McpUpstreamSession["request"] = (method, params) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            entry.active += 1;
          }),
          () =>
            Effect.tryPromise({
              try: (signal) =>
                client.request({ method, params }, ResultSchema, {
                  signal,
                  timeout: REQUEST_TIMEOUT_MS,
                }),
              catch: (cause) =>
                fail(
                  cause instanceof McpError && cause.code !== ErrorCode.ConnectionClosed
                    ? "upstream_error"
                    : (authFailure(config, cause) ?? "unavailable"),
                  cause,
                ),
            }),
          () =>
            Effect.flatMap(Clock.currentTimeMillis, (now) =>
              Effect.sync(() => {
                entry.active -= 1;
                entry.lastUsedAt = now;
              }),
            ),
        ).pipe(
          Effect.tapError((error) =>
            error.reason === "upstream_error"
              ? Effect.void
              : drop(id, entry).pipe(
                  Effect.andThen(registry.reportStatus(id, statusFor(error.reason))),
                ),
          ),
          Effect.withSpan("McpUpstreamClients.request", { attributes: { method } }),
        );

      return {
        capabilities: client.getServerCapabilities() ?? {},
        serverInfo: client.getServerVersion(),
        instructions: client.getInstructions(),
        request,
      };
    }).pipe(Effect.withSpan("McpUpstreamClients.open"));

  const reapIdle = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const [id, entry] of entries) {
      if (entry.active === 0 && now - entry.lastUsedAt > IDLE_CLOSE_MS) yield* drop(id, entry);
    }
  });

  yield* reapIdle.pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.forkIn(scope));
  // A changed or removed server reconnects with its new config on the next call.
  yield* registry.changes.pipe(
    Stream.runForEach((id) => {
      const entry = entries.get(id);
      return entry === undefined ? Effect.void : drop(id, entry);
    }),
    Effect.forkIn(scope),
  );
  yield* Scope.addFinalizer(
    scope,
    Effect.forEach(entries, ([id, entry]) => drop(id, entry), { discard: true }),
  );

  return McpUpstreamClients.of({ open });
});

export const layer = Layer.effect(McpUpstreamClients, make);
