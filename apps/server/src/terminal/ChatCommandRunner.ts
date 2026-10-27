/**
 * Fork: runs a chat code block once, outside any terminal, and returns its
 * output so the client can hand the result back to the agent.
 */
import {
  TerminalRunCommandError,
  type TerminalRunCommandInput,
  type TerminalRunCommandResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import { shouldExcludeTerminalEnvKey } from "./Manager.ts";

const TIMEOUT = "2 minutes";
const MAX_OUTPUT_BYTES = 64 * 1024;

export class ChatCommandRunner extends Context.Service<
  ChatCommandRunner,
  {
    readonly run: (
      input: TerminalRunCommandInput,
    ) => Effect.Effect<TerminalRunCommandResult, TerminalRunCommandError>;
  }
>()("t3/terminal/ChatCommandRunner") {}

/**
 * The runner merges `env` over the server's own environment, so keys the
 * terminal hides are set to undefined, which Node drops at spawn.
 */
export function chatCommandEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const key of Object.keys(baseEnv)) {
    if (shouldExcludeTerminalEnvKey(key)) env[key] = undefined;
  }
  return env;
}

/**
 * Keeps the last `maxBytes` of a stream: build and test failures print at the end, and the
 * runner's own capture keeps the start and returns nothing on timeout.
 */
export function outputTail(maxBytes: number) {
  const chunks: Array<Uint8Array> = [];
  let bytes = 0;
  let dropped = false;
  return {
    push: (chunk: Uint8Array) => {
      chunks.push(chunk);
      bytes += chunk.byteLength;
      while (chunks.length > 1 && bytes - chunks[0]!.byteLength >= maxBytes) {
        bytes -= chunks.shift()!.byteLength;
        dropped = true;
      }
    },
    result: () => {
      let buffer = Buffer.concat(chunks);
      if (buffer.byteLength > maxBytes) {
        buffer = buffer.subarray(buffer.byteLength - maxBytes);
        dropped = true;
      }
      const text = buffer.toString("utf8");
      // A cut can land mid-line or mid-character, so the partial first line goes.
      return { text: dropped ? text.slice(text.indexOf("\n") + 1) : text, truncated: dropped };
    },
  };
}

export function chatCommandInvocation(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  command: string,
): { readonly command: string; readonly args: ReadonlyArray<string> } {
  if (platform === "win32") {
    return { command: "pwsh.exe", args: ["-NoProfile", "-NonInteractive", "-Command", command] };
  }
  // A login shell picks up the PATH the user's terminal would have.
  return { command: env.SHELL ?? "/bin/sh", args: ["-lc", command] };
}

export const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;

  const run: ChatCommandRunner["Service"]["run"] = Effect.fn("ChatCommandRunner.run")(
    function* (input) {
      const invocation = chatCommandInvocation(platform, process.env, input.command);
      const stdout = outputTail(MAX_OUTPUT_BYTES);
      const result = yield* processRunner
        .run({
          ...invocation,
          cwd: input.cwd,
          env: chatCommandEnv(process.env),
          // Closes stdin so a command that prompts fails instead of waiting out the timeout.
          stdin: "",
          timeout: TIMEOUT,
          timeoutBehavior: "timedOutResult",
          onStdoutChunk: stdout.push,
          maxOutputBytes: MAX_OUTPUT_BYTES,
          outputMode: "truncate",
        })
        .pipe(Effect.mapError((cause) => new TerminalRunCommandError({ cwd: input.cwd, cause })));
      const stdoutTail = stdout.result();
      return {
        exitCode: result.code,
        stdout: stdoutTail.text,
        stderr: result.stderr,
        truncated: stdoutTail.truncated || result.stderrTruncated,
        timedOut: result.timedOut,
      };
    },
  );

  return ChatCommandRunner.of({ run });
});

export const layer = Layer.effect(ChatCommandRunner, make);
