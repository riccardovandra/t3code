import * as Schema from "effect/Schema";

import { IsoDateTime, SecretRef, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Also names the server's secrets on disk, so it stays filename-safe. */
export const McpServerId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)).pipe(
  Schema.brand("McpServerId"),
);
export type McpServerId = typeof McpServerId.Type;

/**
 * Providers show the name in tool names such as `mcp__notion__search`, so it is
 * a lowercase slug that cannot impersonate T3 Code's own server.
 */
export const RESERVED_MCP_SERVER_NAMES: ReadonlySet<string> = new Set([
  "t3-code",
  "t3_code",
  "t3code",
]);

export const McpHubServerName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,63}$/),
).annotate({
  description:
    "Lowercase letters, digits, '-' and '_'. Agents see it in tool names such as mcp__<name>__<tool>.",
});

const EnvName = Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/));
const HeaderName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{1,128}$/));
const HttpUrl = TrimmedNonEmptyString.check(Schema.isPattern(/^https?:\/\/\S+$/i)).annotate({
  description: "The server's Streamable HTTP endpoint.",
});

export const McpHubServerTransport = Schema.Union([
  Schema.Struct({ type: Schema.Literal("http"), url: HttpUrl }),
  Schema.Struct({
    type: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString,
    args: Schema.Array(Schema.String),
    env: Schema.Record(EnvName, Schema.String),
    secretEnv: Schema.Array(EnvName).annotate({
      description: "Environment variables whose values are stored as secrets.",
    }),
  }),
]);
export type McpHubServerTransport = typeof McpHubServerTransport.Type;

/** The only path that receives sign-in redirects, so a registered redirect must point at it. */
export const MCP_CLIENT_OAUTH_CALLBACK_PATH = "/oauth/mcp-client/callback";

const OAuthRedirectUri = TrimmedNonEmptyString.check(
  Schema.isPattern(/^https?:\/\/[^/\s?#]+\/oauth\/mcp-client\/callback$/i),
).annotate({
  description:
    "The redirect URI registered with the provider. It must be this T3 Code server's address followed by /oauth/mcp-client/callback.",
});

export const McpServerAuth = Schema.Union([
  Schema.Struct({ type: Schema.Literal("none") }),
  Schema.Struct({ type: Schema.Literal("header"), header: HeaderName }),
  Schema.Struct({
    type: Schema.Literal("oauth"),
    client: Schema.optional(
      Schema.Struct({
        clientId: TrimmedNonEmptyString,
        redirectUri: OAuthRedirectUri,
        hasClientSecret: Schema.Boolean,
      }),
    ).annotate({
      description:
        "A client registered by hand with the provider. Absent means dynamic registration.",
    }),
  }),
]);
export type McpServerAuth = typeof McpServerAuth.Type;

/** What clients see. Secret values stay on the server. */
export const McpHubServerConfig = Schema.Struct({
  id: McpServerId,
  name: McpHubServerName,
  enabled: Schema.Boolean,
  transport: McpHubServerTransport,
  auth: McpServerAuth,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type McpHubServerConfig = typeof McpHubServerConfig.Type;

export const McpServerStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("idle") }),
  Schema.Struct({ state: Schema.Literal("connected") }),
  Schema.Struct({ state: Schema.Literal("needs-sign-in") }),
  Schema.Struct({ state: Schema.Literal("error"), message: Schema.String }),
  Schema.Struct({ state: Schema.Literal("disabled") }),
]);
export type McpServerStatus = typeof McpServerStatus.Type;

export const McpServerEntry = Schema.Struct({
  ...McpHubServerConfig.fields,
  status: McpServerStatus,
});
export type McpServerEntry = typeof McpServerEntry.Type;

export const McpServerListResult = Schema.Struct({ servers: Schema.Array(McpServerEntry) });
export type McpServerListResult = typeof McpServerListResult.Type;

const McpSecretInput = Schema.Struct({
  secret: Schema.optional(TrimmedNonEmptyString),
  secretRef: Schema.optional(SecretRef).annotate({
    description:
      "A secret the user entered through request_secret, used instead of secret. It is consumed by this save.",
  }),
}).annotate({ description: "Omit both secret and secretRef to keep the stored value." });
export type McpSecretInput = typeof McpSecretInput.Type;

export const McpServerUpsertInput = Schema.Struct({
  id: Schema.optional(McpServerId).annotate({
    description: "The server to update. Omit to add a new server.",
  }),
  name: McpHubServerName,
  enabled: Schema.optional(Schema.Boolean).annotate({ description: "Defaults to true." }),
  transport: Schema.Union([
    Schema.Struct({ type: Schema.Literal("http"), url: HttpUrl }),
    Schema.Struct({
      type: Schema.Literal("stdio"),
      command: TrimmedNonEmptyString,
      args: Schema.optional(Schema.Array(Schema.String)),
      env: Schema.optional(Schema.Record(EnvName, Schema.String)),
      secretEnv: Schema.optional(Schema.Record(EnvName, McpSecretInput)).annotate({
        description:
          "Environment variables stored as secrets. Listed names are kept; names left out are removed.",
      }),
    }),
  ]),
  auth: Schema.optional(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal("none") }),
      Schema.Struct({
        type: Schema.Literal("header"),
        header: HeaderName.annotate({ description: "Such as Authorization or X-API-Key." }),
        ...McpSecretInput.fields,
      }).annotate({ description: "Send a stored secret, such as 'Bearer <token>', as a header." }),
      Schema.Struct({
        type: Schema.Literal("oauth"),
        client: Schema.optional(
          Schema.Struct({
            clientId: TrimmedNonEmptyString,
            redirectUri: OAuthRedirectUri,
            clientSecret: Schema.optional(McpSecretInput).annotate({
              description:
                "The registered client secret. Omit for a public client, or to keep the stored secret.",
            }),
          }),
        ).annotate({
          description:
            "Only for providers that reject dynamic client registration or localhost redirects, such as Gamma. Omit to register a client automatically at sign-in.",
        }),
      }).annotate({ description: "Sign in through the server's OAuth flow with startSignIn." }),
    ]),
  ).annotate({ description: "HTTP servers only. Defaults to none." }),
});
export type McpServerUpsertInput = typeof McpServerUpsertInput.Type;

export const McpServerRemoveInput = Schema.Struct({ id: McpServerId });
export type McpServerRemoveInput = typeof McpServerRemoveInput.Type;

export const McpServerSetEnabledInput = Schema.Struct({
  id: McpServerId,
  enabled: Schema.Boolean,
});
export type McpServerSetEnabledInput = typeof McpServerSetEnabledInput.Type;

export const McpServerSignInInput = Schema.Struct({ id: McpServerId });
export type McpServerSignInInput = typeof McpServerSignInInput.Type;

export const McpServerSignInResult = Schema.Struct({
  authorizationUrl: Schema.String.annotate({
    description: "Open in a browser to sign in. It expires after 10 minutes and works once.",
  }),
});
export type McpServerSignInResult = typeof McpServerSignInResult.Type;

export const McpServerSignOutInput = Schema.Struct({ id: McpServerId });
export type McpServerSignOutInput = typeof McpServerSignOutInput.Type;

const MCP_SERVER_FAILURE_MESSAGES = {
  not_found: "That MCP server does not exist.",
  reserved_name: "That name is reserved for T3 Code's own MCP server.",
  duplicate_name: "Another MCP server already uses that name.",
  auth_unsupported: "stdio servers take credentials through secret environment variables.",
  secret_required: "This server needs a secret. Pass secret or secretRef.",
  secret_ref_failed:
    "That secretRef was already used, expired, or does not exist. Ask the user again with request_secret.",
  secret_ref_unscoped: "A secretRef can only be used from the thread that requested it.",
  read_failed: "Could not read the MCP server list.",
  write_failed: "Could not save the MCP server list.",
  secret_failed: "Could not store or read an MCP server secret.",
  not_oauth: "That MCP server does not use OAuth sign-in.",
  sign_in_failed: "Could not start sign-in with that MCP server's authorization server.",
} as const;

export class McpServerError extends Schema.TaggedError<McpServerError>()("McpServerError", {
  reason: Schema.Literals(
    Object.keys(MCP_SERVER_FAILURE_MESSAGES) as Array<keyof typeof MCP_SERVER_FAILURE_MESSAGES>,
  ),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return MCP_SERVER_FAILURE_MESSAGES[this.reason];
  }
}
