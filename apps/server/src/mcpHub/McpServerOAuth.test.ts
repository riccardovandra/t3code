// @effect-diagnostics-next-line nodeBuiltinImport:off -- verifies the PKCE challenge like a real authorization server.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- the fake authorization server is a plain Node HTTP server.
import * as NodeHttp from "node:http";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- reads the fake server's bound port.
import type * as NodeNet from "node:net";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { type McpServerId, SecretRequestError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { cast } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as McpServerOAuth from "./McpServerOAuth.ts";
import * as McpServerRegistry from "./McpServerRegistry.ts";
import * as McpUpstreamClients from "./McpUpstreamClients.ts";

interface FakeOptions {
  readonly rejectRefresh?: boolean;
}

const EXPIRES_IN_SECONDS = 3600;

interface IssuedCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
}

const readBody = (request: NodeHttp.IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => resolve(body));
  });

const json = (response: NodeHttp.ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

/**
 * One origin serving RFC 9728 and RFC 8414 metadata, dynamic registration, a
 * PKCE-checking token endpoint, and an MCP endpoint that accepts only the
 * newest access token.
 */
const makeFakeProvider = (options: FakeOptions) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const state = {
        registrations: [] as Array<Record<string, unknown>>,
        tokenRequests: [] as Array<{ params: URLSearchParams; authorization: string | undefined }>,
        codes: new Map<string, IssuedCode>(),
        issued: 0,
        validToken: undefined as string | undefined,
        rejectRefresh: options.rejectRefresh ?? false,
        upstreamTokens: [] as Array<string>,
      };
      let base = "";
      const httpServer = NodeHttp.createServer((request, response) => {
        void (async () => {
          const url = new URL(request.url ?? "/", base);
          if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
            return json(response, 200, {
              resource: `${base}/mcp`,
              authorization_servers: [base],
            });
          }
          if (url.pathname === "/.well-known/oauth-authorization-server") {
            return json(response, 200, {
              issuer: base,
              authorization_endpoint: `${base}/authorize`,
              token_endpoint: `${base}/token`,
              registration_endpoint: `${base}/register`,
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              code_challenge_methods_supported: ["S256"],
              token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
            });
          }
          if (url.pathname === "/register" && request.method === "POST") {
            const metadata = cast<unknown, Record<string, unknown>>(
              JSON.parse(await readBody(request)),
            );
            state.registrations.push(metadata);
            return json(response, 201, { ...metadata, client_id: "registered-client" });
          }
          if (url.pathname === "/token" && request.method === "POST") {
            const params = new URLSearchParams(await readBody(request));
            state.tokenRequests.push({ params, authorization: request.headers.authorization });
            if (params.get("grant_type") === "authorization_code") {
              const issued = state.codes.get(params.get("code") ?? "");
              const challenge = NodeCrypto.createHash("sha256")
                .update(params.get("code_verifier") ?? "")
                .digest("base64url");
              if (
                issued === undefined ||
                issued.challenge !== challenge ||
                issued.redirectUri !== params.get("redirect_uri") ||
                issued.clientId !== params.get("client_id")
              ) {
                return json(response, 400, { error: "invalid_grant" });
              }
            } else if (state.rejectRefresh) {
              return json(response, 400, { error: "invalid_grant" });
            }
            state.issued += 1;
            state.validToken = `access-${state.issued}`;
            return json(response, 200, {
              access_token: state.validToken,
              token_type: "Bearer",
              expires_in: EXPIRES_IN_SECONDS,
              refresh_token: `refresh-${state.issued}`,
            });
          }
          if (url.pathname === "/mcp") {
            const presented = request.headers.authorization?.replace(/^Bearer /u, "");
            if (presented === undefined || presented !== state.validToken) {
              response.writeHead(401, {
                "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
              });
              response.end();
              return;
            }
            state.upstreamTokens.push(presented);
            const server = new Server(
              { name: "oauth-upstream", version: "1.0.0" },
              { capabilities: { tools: {} } },
            );
            server.setRequestHandler(CallToolRequestSchema, () => ({
              content: [{ type: "text", text: "signed-in" }],
            }));
            const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
            response.on("close", () => void server.close());
            await server.connect(cast<typeof transport, Transport>(transport));
            await transport.handleRequest(request, response);
            return;
          }
          response.writeHead(404).end();
        })();
      });
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      const { port } = cast<ReturnType<typeof httpServer.address>, NodeNet.AddressInfo>(
        httpServer.address(),
      );
      base = `http://127.0.0.1:${port}`;

      /** The user approves at the authorization endpoint, which redirects with a code. */
      const approve = (authorizationUrl: string) => {
        const url = new URL(authorizationUrl);
        const code = `code-${state.codes.size + 1}`;
        state.codes.set(code, {
          clientId: url.searchParams.get("client_id") ?? "",
          redirectUri: url.searchParams.get("redirect_uri") ?? "",
          challenge: url.searchParams.get("code_challenge") ?? "",
        });
        const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", url.searchParams.get("state") ?? "");
        return callback;
      };
      return { httpServer, url: `${base}/mcp`, state, approve };
    }),
    ({ httpServer }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            httpServer.closeAllConnections();
            httpServer.close(() => resolve());
          }),
      ),
  );

const layerSecretRequests = Layer.mock(SecretRequests.SecretRequests)({
  consume: () => Effect.fail(new SecretRequestError({ reason: "ref_unavailable" })),
});

const layerHub = McpUpstreamClients.layer.pipe(
  Layer.provideMerge(McpServerOAuth.layer),
  Layer.provideMerge(McpServerRegistry.layer),
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-oauth-test-" })),
);

const CALLBACK_ORIGIN = "http://t3.test:3773";

const setup = (options: FakeOptions) =>
  Effect.gen(function* () {
    const provider = yield* makeFakeProvider(options);
    const hub = yield* Layer.build(layerHub);
    const registry = Context.get(hub, McpServerRegistry.McpServerRegistry);
    const oauth = Context.get(hub, McpServerOAuth.McpServerOAuth);
    const clients = Context.get(hub, McpUpstreamClients.McpUpstreamClients);
    const secrets = Context.get(hub, ServerSecretStore.ServerSecretStore);
    const statusOf = (id: McpServerId) =>
      registry.list.pipe(
        Effect.map(({ servers }) => servers.find((server) => server.id === id)?.status),
      );
    const hasSecret = (name: string) => secrets.get(name).pipe(Effect.map(Option.isSome));
    const callTool = (id: McpServerId) =>
      clients
        .open(id)
        .pipe(
          Effect.flatMap((session) =>
            session.request("tools/call", { name: "whoami", arguments: {} }),
          ),
        );
    const signIn = (id: McpServerId) =>
      Effect.gen(function* () {
        const { authorizationUrl } = yield* oauth.startSignIn({
          id,
          callbackOrigin: CALLBACK_ORIGIN,
        });
        return yield* oauth.completeSignIn(provider.approve(authorizationUrl));
      });
    return { provider, registry, oauth, statusOf, hasSecret, callTool, signIn };
  });

it.layer(Layer.merge(NodeServices.layer, layerSecretRequests))("McpServerOAuth", (it) => {
  it.effect("signs in with discovery, registration and PKCE, then forwards with the token", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, registry, oauth, statusOf, hasSecret, callTool } = yield* setup({});
        const { id } = yield* registry.upsert({
          name: "notion",
          transport: { type: "http", url: provider.url },
          auth: { type: "oauth" },
        });
        assert.deepStrictEqual(yield* statusOf(id), { state: "needs-sign-in" });
        const notSignedIn = yield* Effect.flip(callTool(id));
        assert.strictEqual(notSignedIn.reason, "needs_sign_in");

        const { authorizationUrl } = yield* oauth.startSignIn({
          id,
          callbackOrigin: `${CALLBACK_ORIGIN}/some/page`,
        });
        const authorization = new URL(authorizationUrl);
        const redirectUri = `${CALLBACK_ORIGIN}/oauth/mcp-client/callback`;
        assert.strictEqual(
          authorization.origin + authorization.pathname,
          `${provider.url.replace("/mcp", "")}/authorize`,
        );
        assert.strictEqual(authorization.searchParams.get("client_id"), "registered-client");
        assert.strictEqual(authorization.searchParams.get("redirect_uri"), redirectUri);
        assert.strictEqual(authorization.searchParams.get("code_challenge_method"), "S256");
        assert.strictEqual(authorization.searchParams.get("resource"), provider.url);
        assert.deepStrictEqual(provider.state.registrations[0]?.redirect_uris, [redirectUri]);

        const { serverName } = yield* oauth.completeSignIn(provider.approve(authorizationUrl));
        assert.strictEqual(serverName, "notion");
        assert.isTrue(yield* hasSecret(McpServerRegistry.oauthTokensSecretName(id)));
        assert.deepStrictEqual(yield* statusOf(id), { state: "idle" });

        const result = yield* callTool(id);
        assert.deepStrictEqual(result.content, [{ type: "text", text: "signed-in" }]);
        assert.deepStrictEqual(provider.state.upstreamTokens.at(-1), "access-1");
        assert.deepStrictEqual(yield* statusOf(id), { state: "connected" });
        assert.notInclude(JSON.stringify(yield* registry.list), "access-1");
      }),
    ),
  );

  it.effect("refreshes an expiring token and a rejected one without a new sign-in", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, registry, signIn, callTool } = yield* setup({});
        const { id } = yield* registry.upsert({
          name: "notion",
          transport: { type: "http", url: provider.url },
          auth: { type: "oauth" },
        });
        yield* signIn(id);
        yield* TestClock.adjust(`${EXPIRES_IN_SECONDS + 1} seconds`);

        yield* callTool(id);
        const grants = provider.state.tokenRequests.map(({ params }) => params.get("grant_type"));
        assert.deepStrictEqual(grants, ["authorization_code", "refresh_token"]);
        assert.strictEqual(
          provider.state.tokenRequests[1]?.params.get("refresh_token"),
          "refresh-1",
        );
        assert.strictEqual(provider.state.upstreamTokens[0], "access-2");

        // The server revokes the token early: the 401 refreshes on the same client.
        provider.state.validToken = "revoked";
        const result = yield* callTool(id);
        assert.deepStrictEqual(result.content, [{ type: "text", text: "signed-in" }]);
        assert.notStrictEqual(provider.state.upstreamTokens.at(-1), "access-2");
      }),
    ),
  );

  it.effect("asks for sign-in again when a refresh fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, registry, signIn, callTool, statusOf, hasSecret } = yield* setup({
          rejectRefresh: true,
        });
        const { id } = yield* registry.upsert({
          name: "notion",
          transport: { type: "http", url: provider.url },
          auth: { type: "oauth" },
        });
        yield* signIn(id);
        yield* TestClock.adjust(`${EXPIRES_IN_SECONDS + 1} seconds`);

        const error = yield* Effect.flip(callTool(id));
        assert.strictEqual(error.reason, "needs_sign_in");
        assert.include(error.message, "needs sign-in");
        assert.deepStrictEqual(yield* statusOf(id), { state: "needs-sign-in" });
        assert.isFalse(yield* hasSecret(McpServerRegistry.oauthTokensSecretName(id)));
      }),
    ),
  );

  it.effect("signing out deletes the stored sign-in", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, registry, oauth, signIn, callTool, statusOf, hasSecret } = yield* setup(
          {},
        );
        const { id } = yield* registry.upsert({
          name: "notion",
          transport: { type: "http", url: provider.url },
          auth: { type: "oauth" },
        });
        yield* signIn(id);
        yield* callTool(id);

        const entry = yield* oauth.signOut({ id });
        assert.deepStrictEqual(entry.status, { state: "needs-sign-in" });
        assert.deepStrictEqual(yield* statusOf(id), { state: "needs-sign-in" });
        assert.isFalse(yield* hasSecret(McpServerRegistry.oauthTokensSecretName(id)));
        assert.isFalse(yield* hasSecret(McpServerRegistry.oauthRegistrationSecretName(id)));
        const error = yield* Effect.flip(callTool(id));
        assert.strictEqual(error.reason, "needs_sign_in");
      }),
    ),
  );

  it.effect("pointing a server at another URL drops its sign-in", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, registry, signIn, statusOf, hasSecret } = yield* setup({});
        const { id } = yield* registry.upsert({
          name: "notion",
          transport: { type: "http", url: provider.url },
          auth: { type: "oauth" },
        });
        yield* signIn(id);
        yield* registry.upsert({
          id,
          name: "notion",
          transport: { type: "http", url: `${provider.url}/v2` },
          auth: { type: "oauth" },
        });
        assert.isFalse(yield* hasSecret(McpServerRegistry.oauthTokensSecretName(id)));
        assert.deepStrictEqual(yield* statusOf(id), { state: "needs-sign-in" });
      }),
    ),
  );

  it.effect("rejects a callback at another address, an unknown state, and a replay", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, registry, oauth, statusOf } = yield* setup({});
        const { id } = yield* registry.upsert({
          name: "notion",
          transport: { type: "http", url: provider.url },
          auth: { type: "oauth" },
        });

        const first = yield* oauth.startSignIn({ id, callbackOrigin: CALLBACK_ORIGIN });
        const elsewhere = provider.approve(first.authorizationUrl);
        elsewhere.host = "attacker.test";
        const moved = yield* Effect.flip(oauth.completeSignIn(elsewhere));
        assert.include(moved.description, "different address");
        // The state was spent by the rejected attempt.
        const replay = yield* Effect.flip(
          oauth.completeSignIn(provider.approve(first.authorizationUrl)),
        );
        assert.include(replay.description, "expired or was already used");

        const unknown = new URL(`${CALLBACK_ORIGIN}/oauth/mcp-client/callback?code=x&state=nope`);
        const unknownError = yield* Effect.flip(oauth.completeSignIn(unknown));
        assert.include(unknownError.description, "expired or was already used");

        const declined = yield* oauth.startSignIn({ id, callbackOrigin: CALLBACK_ORIGIN });
        const declinedCallback = new URL(`${CALLBACK_ORIGIN}/oauth/mcp-client/callback`);
        declinedCallback.searchParams.set(
          "state",
          new URL(declined.authorizationUrl).searchParams.get("state") ?? "",
        );
        declinedCallback.searchParams.set("error", "access_denied");
        const declinedError = yield* Effect.flip(oauth.completeSignIn(declinedCallback));
        assert.include(declinedError.description, "access_denied");

        assert.deepStrictEqual(yield* statusOf(id), { state: "needs-sign-in" });
        assert.isFalse(
          provider.state.tokenRequests.some(
            ({ params }) => params.get("grant_type") === "authorization_code",
          ),
        );
      }),
    ),
  );

  it.effect("a pre-registered client uses its redirect URI and secret without registering", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { provider, registry, oauth, callTool } = yield* setup({});
        const redirectUri = "https://t3.example.com/oauth/mcp-client/callback";
        const entry = yield* registry.upsert({
          name: "gamma",
          transport: { type: "http", url: provider.url },
          auth: {
            type: "oauth",
            client: { clientId: "gamma-client", redirectUri, clientSecret: { secret: "s3cret" } },
          },
        });
        assert.deepStrictEqual(entry.auth, {
          type: "oauth",
          client: { clientId: "gamma-client", redirectUri, hasClientSecret: true },
        });
        assert.notInclude(JSON.stringify(yield* registry.list), "s3cret");

        const { authorizationUrl } = yield* oauth.startSignIn({
          id: entry.id,
          callbackOrigin: "http://localhost:3773",
        });
        const authorization = new URL(authorizationUrl);
        assert.strictEqual(authorization.searchParams.get("client_id"), "gamma-client");
        assert.strictEqual(authorization.searchParams.get("redirect_uri"), redirectUri);
        assert.lengthOf(provider.state.registrations, 0);

        yield* oauth.completeSignIn(provider.approve(authorizationUrl));
        const exchange = provider.state.tokenRequests[0];
        assert.strictEqual(exchange?.params.get("client_secret"), "s3cret");
        assert.strictEqual(exchange?.params.get("redirect_uri"), redirectUri);

        const result = yield* callTool(entry.id);
        assert.deepStrictEqual(result.content, [{ type: "text", text: "signed-in" }]);
      }),
    ),
  );
});
