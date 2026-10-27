import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SkillLibrary from "../../../skills/SkillLibrary.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as SkillTrashHandlers from "./handlers.ts";
import { SkillTrashToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:skill-trash");
const threadId = ThreadId.make("thread:skill-trash");

it.effect("reports the skill a restore put back and where", () =>
  Effect.gen(function* () {
    const toolkit = yield* SkillTrashToolkit;
    const result = yield* toolkit
      .handle("t3_skills_restore", { id: "trash-1" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(result.at(-1)?.result).toEqual({
      name: "teach",
      paths: ["/repo/.agents/skills/teach"],
    });
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(SkillTrashHandlers.layer).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            ThreadCommandExecutor.layer,
            Layer.succeed(McpInvocationContext.McpInvocationContext, {
              environmentId,
              requestNamespace: "provider:skill-trash",
              thread: {
                threadId,
                providerSessionId: "provider:skill-trash",
                providerInstanceId: ProviderInstanceId.make("codex"),
              },
              client: undefined,
              capabilities: new Set(["orchestration" as const]),
              issuedAt: 0,
            }),
            Layer.mock(ThreadManagement.ThreadManagementService)({
              getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
            }),
            Layer.mock(Environment.ServerEnvironment)({
              getDescriptor: Effect.succeed({
                environmentId,
                label: "Test",
                platform: { os: "linux", arch: "x64" },
                serverVersion: "0.0.0",
                capabilities: { repositoryIdentity: false },
              }),
            }),
            Layer.mock(SkillLibrary.SkillLibrary)({
              restoreFromTrash: (input) =>
                Effect.succeed({
                  id: input.id,
                  name: "teach",
                  target: { kind: "project", cwd: "/repo" },
                  removedAt: "2026-10-24T00:00:00.000Z",
                  paths: ["/repo/.agents/skills/teach"],
                }),
            }),
          ),
        ),
      ),
    ),
  ),
);
