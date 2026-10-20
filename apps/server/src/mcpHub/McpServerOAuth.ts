/**
 * OAuth sign-in for configured MCP servers, built on the SDK's client auth
 * helpers: metadata discovery, dynamic client registration, PKCE and refresh.
 * Tokens and registrations live in ServerSecretStore; a pending sign-in lives
 * only in memory, so a restart asks the user to start again.
 */
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  type OAuthClientInformationMixed,
  OAuthClientInformationFullSchema,
  type OAuthClientMetadata,
  type OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  MCP_CLIENT_OAUTH_CALLBACK_PATH,
  type McpServerConfig,
  type McpServerEntry,
  McpServerError,
  type McpServerId,
  type McpServerSignInResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { renderMcpClientSignInPage } from "../auth/mcpOAuthHtml.ts";
import * as McpServerRegistry from "./McpServerRegistry.ts";

const PENDING_SIGN_IN_TTL_MS = 10 * 60_000;
/** Refresh a little early so a token does not expire between the check and the request. */
const EXPIRY_SKEW_MS = 60_000;

export class McpSignInCallbackError extends Schema.TaggedError<McpSignInCallbackError>()(
  "McpSignInCallbackError",
  { description: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

interface StoredSession {
  readonly tokens: OAuthTokens;
  readonly expiresAt?: number;
  /** A refresh must present the client the tokens were issued to, with its redirect. */
  readonly redirectUri: string;
}

interface PendingSignIn {
  readonly serverId: McpServerId;
  readonly identity: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
  codeVerifier: string | undefined;
  discovery: OAuthDiscoveryState | undefined;
}

type OAuthServerConfig = McpServerConfig & {
  readonly transport: { readonly type: "http"; readonly url: string };
  readonly auth: Extract<McpServerConfig["auth"], { readonly type: "oauth" }>;
};

const isOAuthServer = (config: McpServerConfig): config is OAuthServerConfig =>
  config.auth.type === "oauth" && config.transport.type === "http";

/** Tokens for one server or registered client are not valid for another. */
const identityOf = (config: OAuthServerConfig) =>
  `${config.transport.url} ${config.auth.client?.clientId ?? ""}`;

const clientMetadata = (redirectUri: string): OAuthClientMetadata => ({
  client_name: "T3 Code",
  redirect_uris: [redirectUri],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
});

const StoredSessionJson = Schema.fromJsonString(
  Schema.Struct({
    tokens: Schema.Unknown,
    expiresAt: Schema.optional(Schema.Number),
    redirectUri: Schema.String,
  }),
);
const decodeStoredSession = Schema.decodeUnknownOption(StoredSessionJson);
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Forwarding ran into a sign-in it cannot complete without the user. */
const needsSignIn = () => new UnauthorizedError("This MCP server needs sign-in in T3 Code.");

export class McpServerOAuth extends Context.Service<
  McpServerOAuth,
  {
    /** `callbackOrigin` is the T3 Code address the user's browser will return to. */
    readonly startSignIn: (input: {
      readonly id: McpServerId;
      readonly callbackOrigin: string;
    }) => Effect.Effect<McpServerSignInResult, McpServerError>;
    readonly completeSignIn: (
      callbackUrl: URL,
    ) => Effect.Effect<{ readonly serverName: string }, McpSignInCallbackError>;
    readonly signOut: (input: {
      readonly id: McpServerId;
    }) => Effect.Effect<McpServerEntry, McpServerError>;
    /**
     * A provider for the forwarding client's transport, backed by the stored
     * tokens, or undefined when the server is not signed in. It refreshes on
     * expiry and on a 401 without rebuilding the client, and never starts an
     * interactive sign-in: those fail with the SDK's UnauthorizedError.
     */
    readonly forwardingProvider: (
      config: McpServerConfig,
    ) => Effect.Effect<OAuthClientProvider | undefined>;
  }
>()("t3/mcpHub/McpServerOAuth") {}

const make = Effect.gen(function* () {
  const registry = yield* McpServerRegistry.McpServerRegistry;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const crypto = yield* Crypto.Crypto;
  const context = yield* Effect.context<never>();
  const pending = new Map<string, PendingSignIn>();
  const discoveries = new Map<McpServerId, OAuthDiscoveryState>();
  const refreshes = new Map<McpServerId, Promise<unknown>>();

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readText = (name: string) =>
    secrets
      .get(name)
      .pipe(
        Effect.map(Option.map((bytes) => decoder.decode(bytes))),
        Effect.map(Option.getOrUndefined),
      );
  const writeText = (name: string, value: string) => secrets.set(name, encoder.encode(value));

  // Provider callbacks run inside SDK promises, so storage failures surface as rejections there.
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseWith(context)(effect);

  const loadSession = (id: McpServerId) =>
    readText(McpServerRegistry.oauthTokensSecretName(id)).pipe(
      Effect.map((text): StoredSession | undefined => {
        if (text === undefined) return undefined;
        const stored = Option.getOrUndefined(decodeStoredSession(text));
        const tokens = OAuthTokensSchema.safeParse(stored?.tokens);
        if (stored === undefined || !tokens.success) return undefined;
        return {
          tokens: tokens.data,
          redirectUri: stored.redirectUri,
          ...(stored.expiresAt === undefined ? {} : { expiresAt: stored.expiresAt }),
        };
      }),
    );

  const saveSession = (id: McpServerId, redirectUri: string, tokens: OAuthTokens) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const session: StoredSession = {
        tokens,
        redirectUri,
        ...(tokens.expires_in === undefined ? {} : { expiresAt: now + tokens.expires_in * 1000 }),
      };
      yield* writeText(McpServerRegistry.oauthTokensSecretName(id), encodeJson(session));
    });

  const loadRegistration = (id: McpServerId) =>
    readText(McpServerRegistry.oauthRegistrationSecretName(id)).pipe(
      Effect.map((text) => {
        if (text === undefined) return undefined;
        const parsed = OAuthClientInformationFullSchema.safeParse(
          Option.getOrUndefined(decodeJson(text)),
        );
        return parsed.success ? parsed.data : undefined;
      }),
    );

  const clientInformation = (config: OAuthServerConfig) =>
    Effect.gen(function* () {
      const client = config.auth.client;
      if (client === undefined) return yield* loadRegistration(config.id);
      const secret = client.hasClientSecret
        ? yield* readText(McpServerRegistry.oauthClientSecretName(config.id))
        : undefined;
      const information: OAuthClientInformationMixed = {
        client_id: client.clientId,
        ...(secret === undefined ? {} : { client_secret: secret }),
      };
      return information;
    });

  const forgetSession = (id: McpServerId) =>
    Effect.gen(function* () {
      discoveries.delete(id);
      yield* Effect.forEach(
        [
          McpServerRegistry.oauthTokensSecretName(id),
          McpServerRegistry.oauthRegistrationSecretName(id),
        ],
        (name) => secrets.remove(name).pipe(Effect.ignore({ log: true })),
      );
    });

  /** One provider for both halves of a sign-in: building the URL and exchanging the code. */
  const signInProvider = (
    config: OAuthServerConfig,
    state: string,
    flow: PendingSignIn,
    onRedirect: (url: URL) => void,
  ): OAuthClientProvider => ({
    redirectUrl: flow.redirectUri,
    clientMetadata: clientMetadata(flow.redirectUri),
    state: () => state,
    clientInformation: () =>
      run(
        config.auth.client === undefined
          ? loadRegistration(config.id).pipe(
              // A registration made for another return address cannot complete this one.
              Effect.map((registration) =>
                registration?.redirect_uris.includes(flow.redirectUri) ? registration : undefined,
              ),
            )
          : clientInformation(config),
      ),
    saveClientInformation: (information) =>
      run(
        writeText(
          McpServerRegistry.oauthRegistrationSecretName(config.id),
          encodeJson(information),
        ),
      ),
    // A sign-in always asks the user, even over tokens that could still be refreshed.
    tokens: () => undefined,
    saveTokens: (tokens) => run(saveSession(config.id, flow.redirectUri, tokens)),
    redirectToAuthorization: onRedirect,
    saveCodeVerifier: (verifier) => {
      flow.codeVerifier = verifier;
    },
    codeVerifier: () => {
      if (flow.codeVerifier === undefined) throw new Error("No PKCE verifier for this sign-in.");
      return flow.codeVerifier;
    },
    saveDiscoveryState: (discovery) => {
      flow.discovery = discovery;
    },
    discoveryState: () => flow.discovery,
  });

  const startSignIn: McpServerOAuth["Service"]["startSignIn"] = (input) =>
    Effect.gen(function* () {
      const config = yield* registry.get(input.id);
      if (config === undefined) return yield* new McpServerError({ reason: "not_found" });
      if (!isOAuthServer(config)) return yield* new McpServerError({ reason: "not_oauth" });

      const now = yield* Clock.currentTimeMillis;
      for (const [key, flow] of pending) if (flow.expiresAt <= now) pending.delete(key);
      const state = Buffer.from(yield* crypto.randomBytes(32).pipe(Effect.orDie)).toString(
        "base64url",
      );
      const flow: PendingSignIn = {
        serverId: config.id,
        identity: identityOf(config),
        redirectUri:
          config.auth.client?.redirectUri ??
          `${new URL(input.callbackOrigin).origin}${MCP_CLIENT_OAUTH_CALLBACK_PATH}`,
        expiresAt: now + PENDING_SIGN_IN_TTL_MS,
        codeVerifier: undefined,
        discovery: undefined,
      };
      let authorizationUrl: URL | undefined;
      yield* Effect.tryPromise({
        try: () =>
          auth(
            signInProvider(config, state, flow, (url) => {
              authorizationUrl = url;
            }),
            { serverUrl: config.transport.url },
          ),
        catch: (cause) => new McpServerError({ reason: "sign_in_failed", cause }),
      });
      if (authorizationUrl === undefined) {
        return yield* new McpServerError({ reason: "sign_in_failed" });
      }
      pending.set(state, flow);
      return { authorizationUrl: authorizationUrl.href };
    }).pipe(Effect.withSpan("McpServerOAuth.startSignIn"));

  const callbackFailure = (description: string, cause?: unknown) =>
    new McpSignInCallbackError({ description, ...(cause === undefined ? {} : { cause }) });

  // Scheme is left out: behind a TLS-terminating proxy the server may see http
  // for a browser that is on https.
  const sameEndpoint = (left: URL, right: URL) =>
    left.host === right.host && left.pathname === right.pathname;

  const completeSignIn: McpServerOAuth["Service"]["completeSignIn"] = (callbackUrl) =>
    Effect.gen(function* () {
      const params = callbackUrl.searchParams;
      const state = params.get("state") ?? "";
      const flow = pending.get(state);
      // Single use: a replayed callback finds nothing.
      pending.delete(state);
      if (flow === undefined || flow.expiresAt <= (yield* Clock.currentTimeMillis)) {
        return yield* callbackFailure(
          "This sign-in link expired or was already used. Start sign-in again from T3 Code.",
        );
      }
      if (!sameEndpoint(callbackUrl, new URL(flow.redirectUri))) {
        return yield* callbackFailure(
          "This sign-in returned to a different address than the one it started from. Start sign-in again from T3 Code.",
        );
      }
      const providerError = params.get("error");
      if (providerError !== null) {
        return yield* callbackFailure(
          `The provider did not complete the sign-in: ${params.get("error_description") ?? providerError}.`,
        );
      }
      const code = params.get("code");
      if (code === null || code === "") {
        return yield* callbackFailure("The provider returned no authorization code.");
      }
      const config = yield* registry
        .get(flow.serverId)
        .pipe(
          Effect.mapError((cause) => callbackFailure("Could not read the MCP server list.", cause)),
        );
      if (config === undefined || !isOAuthServer(config) || identityOf(config) !== flow.identity) {
        return yield* callbackFailure(
          "This MCP server was removed or changed while signing in. Start sign-in again from T3 Code.",
        );
      }
      yield* Effect.tryPromise({
        try: () =>
          auth(
            signInProvider(config, state, flow, () => {
              throw new Error("The authorization server asked for a second sign-in.");
            }),
            { serverUrl: config.transport.url, authorizationCode: code },
          ),
        catch: (cause) =>
          callbackFailure(
            "The provider rejected the sign-in when T3 Code exchanged the code.",
            cause,
          ),
      });
      discoveries.delete(config.id);
      yield* registry.resetConnection(config.id);
      return { serverName: config.name };
    }).pipe(Effect.withSpan("McpServerOAuth.completeSignIn"));

  const signOut: McpServerOAuth["Service"]["signOut"] = (input) =>
    Effect.gen(function* () {
      const config = yield* registry.get(input.id);
      if (config === undefined) return yield* new McpServerError({ reason: "not_found" });
      if (!isOAuthServer(config)) return yield* new McpServerError({ reason: "not_oauth" });
      yield* forgetSession(config.id);
      yield* registry.resetConnection(config.id);
      const entry = (yield* registry.list).servers.find((server) => server.id === config.id);
      if (entry === undefined) return yield* new McpServerError({ reason: "not_found" });
      return entry;
    }).pipe(Effect.withSpan("McpServerOAuth.signOut"));

  const forwardingProvider: McpServerOAuth["Service"]["forwardingProvider"] = (config) =>
    Effect.gen(function* () {
      if (!isOAuthServer(config)) return undefined;
      const session = yield* loadSession(config.id).pipe(Effect.orElseSucceed(() => undefined));
      if (session === undefined) return undefined;
      const { id } = config;
      const serverUrl = config.transport.url;
      const { redirectUri } = session;

      const storedTokens = () => run(loadSession(id).pipe(Effect.map((stored) => stored?.tokens)));
      const base: OAuthClientProvider = {
        redirectUrl: redirectUri,
        clientMetadata: clientMetadata(redirectUri),
        // No saveClientInformation: forwarding never registers a client on its own.
        clientInformation: async () => {
          const information = await run(clientInformation(config));
          if (information === undefined) throw needsSignIn();
          return information;
        },
        tokens: storedTokens,
        saveTokens: (tokens) => run(saveSession(id, redirectUri, tokens)),
        redirectToAuthorization: () => {
          throw needsSignIn();
        },
        saveCodeVerifier: () => undefined,
        codeVerifier: () => {
          throw needsSignIn();
        },
        invalidateCredentials: (scope) =>
          run(
            Effect.gen(function* () {
              if (scope === "discovery") {
                discoveries.delete(id);
                return;
              }
              if (scope === "verifier") return;
              yield* secrets
                .remove(McpServerRegistry.oauthTokensSecretName(id))
                .pipe(Effect.ignore({ log: true }));
              if (scope === "all" || scope === "client") {
                discoveries.delete(id);
                yield* secrets
                  .remove(McpServerRegistry.oauthRegistrationSecretName(id))
                  .pipe(Effect.ignore({ log: true }));
              }
            }),
          ),
        saveDiscoveryState: (discovery) => {
          discoveries.set(id, discovery);
        },
        discoveryState: () => discoveries.get(id),
      };

      // Concurrent requests share one refresh, since many servers rotate the
      // refresh token and a second refresh would present a spent one.
      const refresh = () => {
        const existing = refreshes.get(id);
        if (existing !== undefined) return existing;
        const flight = auth(base, { serverUrl }).finally(() => refreshes.delete(id));
        refreshes.set(id, flight);
        return flight;
      };

      const provider: OAuthClientProvider = {
        ...base,
        tokens: async () => {
          const stored = await run(loadSession(id));
          if (stored === undefined) return undefined;
          const now = await run(Clock.currentTimeMillis);
          const expiring =
            stored.expiresAt !== undefined && now >= stored.expiresAt - EXPIRY_SKEW_MS;
          if (!expiring || stored.tokens.refresh_token === undefined) return stored.tokens;
          await refresh();
          return storedTokens();
        },
      };
      return provider;
    });

  return McpServerOAuth.of({ startSignIn, completeSignIn, signOut, forwardingProvider });
});

export const layer = Layer.effect(McpServerOAuth, make);

const PAGE_HEADERS = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

/**
 * Where the authorization server sends the browser back. It carries no T3
 * credential, since the browser may be a phone's system browser; the
 * single-use state from startSignIn is what ties it to a sign-in.
 */
export const layerCallbackRoute = Layer.unwrap(
  Effect.gen(function* () {
    const oauth = yield* McpServerOAuth;
    return HttpRouter.add(
      "GET",
      MCP_CLIENT_OAUTH_CALLBACK_PATH,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const result = yield* Option.match(HttpServerRequest.toURL(request), {
          onNone: () =>
            Effect.fail(new McpSignInCallbackError({ description: "Invalid request." })),
          onSome: oauth.completeSignIn,
        }).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("MCP server sign-in failed", {
              description: error.description,
              cause: error.cause,
            }),
          ),
          Effect.result,
        );
        const page =
          result._tag === "Success"
            ? renderMcpClientSignInPage({ ok: true, serverName: result.success.serverName })
            : renderMcpClientSignInPage({ ok: false, description: result.failure.description });
        return HttpServerResponse.text(page, {
          status: result._tag === "Success" ? 200 : 400,
          contentType: "text/html; charset=utf-8",
          headers: PAGE_HEADERS,
        });
      }),
    );
  }),
);
