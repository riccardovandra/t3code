import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProcessRunner from "../processRunner.ts";
import * as AiPmService from "./AiPmService.ts";

const summary = {
  id: "demo",
  name: "Demo",
  owner: "Riccardo",
  area: "client",
  now: "Build",
  waiting_on_you: 1,
  done: 1,
  total: 2,
  open_version: { version: "v1", outcome: "Understand in 30 seconds" },
};
const sourceBrief = {
  id: "demo",
  name: "Demo",
  owner: "Riccardo",
  objective: "Project visibility",
  now: "Build the UI",
  updated: "2026-10-19",
  progress: { done: 1, total: 2 },
  open_version: summary.open_version,
  next_actions: [
    { title: "Review design", owner: "you", ref: "demo/ui" },
    { title: "Legacy action", owner: "you", step: "demo/ui" },
  ],
  plan: [
    {
      name: "Build",
      steps: [
        {
          ref: "demo/ui",
          title: "UI",
          state: "check",
          owner: "codex",
          syncDue: true,
          history: [
            { date: "2026-10-19", text: "Agent reported completion" },
            { date: "2026-10-18", text: "Older evidence" },
          ],
          sync: { flags: [{ kind: "conflict" }], claims: [{ quote: "huge history" }] },
        },
      ],
    },
  ],
};
const output = (value: unknown): ProcessRunner.ProcessRunOutput => ({
  stdout: JSON.stringify(value),
  stderr: "",
  code: ChildProcessSpawner.ExitCode(0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
const testLayer = (run: ProcessRunner.ProcessRunner["Service"]["run"]) =>
  AiPmService.layer.pipe(
    Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, { run })),
    Layer.provide(Path.layer),
  );

describe("AI PM read adapter", () => {
  it.effect(
    "returns compact board data and preserves evidence warnings without claiming verification",
    () =>
      Effect.gen(function* () {
        const aiPm = yield* AiPmService.AiPmService;
        const list = yield* aiPm.list();
        expect(list.projects[0]).toMatchObject({
          area: "client",
          waitingOnYou: 1,
          version: "v1",
          done: 1,
          total: 2,
        });
        const brief = yield* aiPm.brief({ projectId: "demo" });
        expect(brief.next[0]).toMatchObject({ title: "Review design", step: "demo/ui" });
        expect(brief.next[1]).toMatchObject({ title: "Legacy action", step: "demo/ui" });
        expect(brief.phases[0]?.steps[0]).toMatchObject({
          state: "check",
          lastProgress: "2026-10-19: Agent reported completion",
          warnings: [
            "Specification changed since the last status check.",
            "Status evidence needs review.",
          ],
        });
        expect(JSON.stringify(brief)).not.toContain("huge history");
        expect(Number.isNaN(Date.parse(brief.fetchedAt))).toBe(false);
      }).pipe(
        Effect.provide(
          testLayer(({ args }) =>
            Effect.succeed(output(args[0] === "list" ? [summary] : sourceBrief)),
          ),
        ),
      ),
  );

  it.effect("uses bounded argv invocation and configured executable", () => {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    return Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      yield* aiPm.brief({ projectId: "demo" });
      expect(calls.map((call) => call.args)).toEqual([
        ["list", "--json"],
        ["brief", "demo", "--json"],
      ]);
      expect(calls[1]).toMatchObject({
        command: "/custom/aipm",
        timeout: "15 seconds",
        maxOutputBytes: 2097152,
        outputMode: "error",
      });
      expect(calls[1]?.env?.PATH).toBe("/usr/bin:/test-home/.local/bin");
    }).pipe(
      Effect.provide(
        testLayer((input) => {
          calls.push(input);
          return Effect.succeed(output(input.args[0] === "list" ? [summary] : sourceBrief));
        }),
      ),
      Effect.provideService(HostProcess.Environment, {
        T3CODE_AIPM_EXECUTABLE: "/custom/aipm",
        PATH: "/usr/bin",
      }),
      Effect.provideService(HostProcess.HomeDirectory, "/test-home"),
    );
  });

  it.effect("rejects unknown IDs without invoking brief", () => {
    let count = 0;
    return Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const error = yield* aiPm.brief({ projectId: "--help" }).pipe(Effect.flip);
      expect(error.reason).toBe("project_not_found");
      expect(count).toBe(1);
    }).pipe(
      Effect.provide(
        testLayer(() => {
          count++;
          return Effect.succeed(output([summary]));
        }),
      ),
    );
  });

  it.effect("rejects incompatible JSON without exposing board contents", () =>
    Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const error = yield* aiPm.list().pipe(Effect.flip);
      expect(error.reason).toBe("invalid_data");
      expect(error.message).not.toContain("private contents");
    }).pipe(
      Effect.provide(
        testLayer(() => Effect.succeed({ ...output(null), stdout: "private contents" })),
      ),
    ),
  );

  it.effect("rejects structurally incompatible JSON", () =>
    Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const error = yield* aiPm.list().pipe(Effect.flip);
      expect(error.reason).toBe("invalid_data");
    }).pipe(Effect.provide(testLayer(() => Effect.succeed(output([{ id: "demo" }]))))),
  );

  it.effect("does not publish a failed command's partial output", () =>
    Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const error = yield* aiPm.list().pipe(Effect.flip);
      expect(error.reason).toBe("command_failed");
    }).pipe(
      Effect.provide(
        testLayer(() =>
          Effect.succeed({ ...output([summary]), code: ChildProcessSpawner.ExitCode(1) }),
        ),
      ),
    ),
  );

  it.effect("rejects a mismatched project brief", () =>
    Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const error = yield* aiPm.brief({ projectId: "demo" }).pipe(Effect.flip);
      expect(error.reason).toBe("invalid_data");
    }).pipe(
      Effect.provide(
        testLayer(({ args }) =>
          Effect.succeed(output(args[0] === "list" ? [summary] : { ...sourceBrief, id: "other" })),
        ),
      ),
    ),
  );

  it.effect.each([
    ["ProcessSpawnError", "unavailable"],
    ["ProcessTimeoutError", "timeout"],
    ["ProcessOutputLimitError", "output_limit"],
  ] as const)("maps %s to a safe error", ([tag, reason]) =>
    Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const error = yield* aiPm.list().pipe(Effect.flip);
      expect(error.reason).toBe(reason);
    }).pipe(
      Effect.provide(
        testLayer(() =>
          Effect.fail(
            tag === "ProcessSpawnError"
              ? new ProcessRunner.ProcessSpawnError({
                  command: "aipm",
                  argumentCount: 2,
                  cause: new Error("private path"),
                })
              : tag === "ProcessTimeoutError"
                ? new ProcessRunner.ProcessTimeoutError({
                    command: "aipm",
                    argumentCount: 2,
                    timeoutMs: 15000,
                  })
                : new ProcessRunner.ProcessOutputLimitError({
                    command: "aipm",
                    argumentCount: 2,
                    stream: "stdout",
                    maxBytes: 2097152,
                    observedBytes: 2097153,
                  }),
          ),
        ),
      ),
    ),
  );

  const sourceIdea = {
    id: "ai-delivery-factory",
    title: "AI Delivery Factory",
    status: "parked",
    summary: "Three concepts and a wizard prototype.",
    next: "Pick one concept",
    threads: [{ id: "thread-1", title: "Concepts", environment: "env-1" }],
    files: [{ path: "/work/wizard.html" }],
    created: "2026-10-19",
    updated: "2026-10-19",
  };

  it.effect("lists ideas with a null project when none is linked", () =>
    Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const result = yield* aiPm.ideas();
      expect(result.ideas).toEqual([{ ...sourceIdea, project: null }]);
    }).pipe(Effect.provide(testLayer(() => Effect.succeed(output([sourceIdea]))))),
  );

  it.effect("sends idea text over stdin, never as arguments", () => {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const input = {
      title: "--help",
      summary: "--replace-links",
      next: "Pick one",
      threads: [{ id: "thread-1" }],
      files: [],
    };
    return Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      yield* aiPm.saveIdea(input, { mergeLinks: true });
      yield* aiPm.saveIdea(input, { mergeLinks: false });
      expect(calls.map((call) => call.args)).toEqual([
        ["idea", "save", "--stdin", "--json"],
        ["idea", "save", "--stdin", "--replace-links", "--json"],
      ]);
      expect(JSON.parse(calls[0]!.stdin!)).toEqual(input);
    }).pipe(
      Effect.provide(
        testLayer((call) => {
          calls.push(call);
          return Effect.succeed(output(sourceIdea));
        }),
      ),
    );
  });

  it.effect("sets, keeps, and clears the promoted project link", () => {
    const calls: Array<ReadonlyArray<string>> = [];
    return Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      yield* aiPm.setIdeaStatus({ id: "idea", status: "promoted", projectId: "demo" });
      yield* aiPm.setIdeaStatus({ id: "idea", status: "promoted", projectId: null });
      const idea = yield* aiPm.setIdeaStatus({ id: "idea", status: "exploring" });
      expect(idea.status).toBe("exploring");
      expect(calls).toEqual([
        ["idea", "status", "idea", "promoted", "--project", "demo", "--json"],
        ["idea", "status", "idea", "promoted", "--project", "none", "--json"],
        ["idea", "status", "idea", "exploring", "--json"],
      ]);
    }).pipe(
      Effect.provide(
        testLayer(({ args }) => {
          calls.push(args);
          return Effect.succeed(output({ ...sourceIdea, status: "exploring" }));
        }),
      ),
    );
  });

  it.effect.each([
    ['aipm: no idea "gone"', "idea_not_found"],
    ['aipm: no project "gone"', "project_not_found"],
    ["aipm: an idea needs a title", "write_failed"],
  ] as const)("maps the write refusal %s without its text", ([stderr, reason]) =>
    Effect.gen(function* () {
      const aiPm = yield* AiPmService.AiPmService;
      const error = yield* aiPm.setIdeaStatus({ id: "gone", status: "parked" }).pipe(Effect.flip);
      expect(error.reason).toBe(reason);
      expect(error.message).not.toContain("aipm:");
    }).pipe(
      Effect.provide(
        testLayer(() =>
          Effect.succeed({ ...output(null), stderr, code: ChildProcessSpawner.ExitCode(1) }),
        ),
      ),
    ),
  );
});
