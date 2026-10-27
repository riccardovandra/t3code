/** Whether this environment's MCP hub connects agents to Docs Cloud. */
import type { McpServerListResult } from "@t3tools/contracts";
import { DOCS_CLOUD_MCP_SERVER_NAME } from "@t3tools/provider-core/server/orchestrationInstructions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import * as McpServerRegistry from "../mcpHub/McpServerRegistry.ts";

/** Matches the servers provider sessions get: enabled hub entries, by name. */
const docsCloudConnected = ({ servers }: McpServerListResult): boolean =>
  servers.some((server) => server.enabled && server.name === DOCS_CLOUD_MCP_SERVER_NAME);

export class DocsCloudConnection extends Context.Service<
  DocsCloudConnection,
  {
    /** Emits the new value each time the connection is set up or removed. */
    readonly changes: Stream.Stream<boolean>;
  }
>()("t3/docs/DocsCloudConnection") {}

const make = Effect.gen(function* () {
  const registry = yield* McpServerRegistry.McpServerRegistry;
  let connected = yield* registry.list.pipe(
    Effect.map(docsCloudConnected),
    Effect.catch((cause) =>
      Effect.logWarning("Could not read configured MCP servers for Docs Cloud.", { cause }).pipe(
        Effect.as(false),
      ),
    ),
  );
  const changed = yield* PubSub.unbounded<boolean>();
  yield* registry.subscribeList.pipe(
    Stream.retry(Schedule.spaced("5 seconds")),
    Stream.map(docsCloudConnected),
    Stream.runForEach((next) => {
      if (next === connected) return Effect.void;
      connected = next;
      return PubSub.publish(changed, next);
    }),
    Effect.forkScoped,
  );
  return DocsCloudConnection.of({ changes: Stream.fromPubSub(changed) });
});

export const layer = Layer.effect(DocsCloudConnection, make);
