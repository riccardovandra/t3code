import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeOS from "node:os";

import * as ProcessRunner from "../processRunner.ts";
import * as ChatCommandRunner from "./ChatCommandRunner.ts";

const TestLayer = ChatCommandRunner.layer.pipe(
  Layer.provide(ProcessRunner.layer),
  Layer.provide(NodeServices.layer),
);

describe("chatCommandEnv", () => {
  it("hides the server's own variables and keeps the user's", () => {
    const env = ChatCommandRunner.chatCommandEnv({
      PATH: "/usr/bin",
      T3CODE_AUTH_TOKEN: "secret",
      VITE_WS_URL: "ws://localhost",
    });
    assert.isTrue(Object.hasOwn(env, "T3CODE_AUTH_TOKEN"));
    assert.isUndefined(env.T3CODE_AUTH_TOKEN);
    assert.isUndefined(env.VITE_WS_URL);
    assert.isFalse(Object.hasOwn(env, "PATH"));
  });
});

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("ChatCommandRunner", () => {
  it.effect("returns the exit code and both output streams from the given folder", () =>
    Effect.gen(function* () {
      const runner = yield* ChatCommandRunner.ChatCommandRunner;
      const cwd = NodeOS.tmpdir();
      const result = yield* runner.run({ cwd, command: "pwd; echo oops >&2; exit 3" });
      assert.strictEqual(result.exitCode, 3);
      assert.include(result.stdout, NodeOS.tmpdir().split("/").at(-1) ?? "");
      assert.strictEqual(result.stderr.trim(), "oops");
      assert.isFalse(result.timedOut);
      assert.isFalse(result.truncated);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("keeps the end of output longer than the cap", () =>
    Effect.gen(function* () {
      const runner = yield* ChatCommandRunner.ChatCommandRunner;
      const result = yield* runner.run({
        cwd: NodeOS.tmpdir(),
        command: "yes line | head -n 20000; echo FINAL ERROR",
      });
      assert.isTrue(result.stdout.endsWith("line\nFINAL ERROR\n"));
      assert.isTrue(result.stdout.startsWith("line\n"));
      assert.isAtMost(Buffer.byteLength(result.stdout), 64 * 1024);
      assert.isTrue(result.truncated);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("does not expose server variables to the command", () =>
    Effect.gen(function* () {
      process.env.T3CODE_CHAT_COMMAND_TEST = "hidden";
      const runner = yield* ChatCommandRunner.ChatCommandRunner;
      const result = yield* runner
        .run({ cwd: NodeOS.tmpdir(), command: 'printf "%s" "${T3CODE_CHAT_COMMAND_TEST:-unset}"' })
        .pipe(Effect.ensuring(Effect.sync(() => delete process.env.T3CODE_CHAT_COMMAND_TEST)));
      assert.strictEqual(result.stdout, "unset");
    }).pipe(Effect.provide(TestLayer)),
  );
});
