import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as UsageLimitRecoveryWorker from "./UsageLimitRecoveryWorker.ts";
import { limitFailoverCommand, limitRecoveryCommand } from "./UsageLimitRecoveryWorker.ts";

const claude = ProviderInstanceId.make("claudeAgent");
const claudeWork = ProviderInstanceId.make("claudeAgent_work");
const claudeSpare = ProviderInstanceId.make("claudeAgent_spare");
const codex = ProviderInstanceId.make("codex");
const runId = RunId.make("run-1");
const failedAt = Date.parse("2026-10-27T10:00:00.000Z");
const resetAt = "2026-10-27T15:00:00.000Z";
const now = failedAt + 60_000;

const candidate = (
  overrides: Partial<ProjectionStore.ProjectionLimitRecoveryCandidate> = {},
): ProjectionStore.ProjectionLimitRecoveryCandidate => ({
  id: ThreadId.make("thread-1"),
  status: "failed",
  lastErrorClass: "usage_limit",
  latestRunId: runId,
  usageLimitResetAt: resetAt,
  archivedAt: null,
  settledOverride: null,
  pendingRuntimeRequest: null,
  latestRunCompletedAt: DateTime.makeUnsafe(failedAt),
  updatedAt: DateTime.makeUnsafe(failedAt),
  limitRecovery: null,
  snoozedUntil: null,
  projectId: ProjectId.make("project-1"),
  providerInstanceId: claude,
  modelSelection: {
    instanceId: claude,
    model: "claude-opus-5-5",
    options: [{ id: "effort", value: "max" }],
  },
  ...overrides,
});

const instance = (driver: string, displayName?: string) => ({
  driver: ProviderDriverKind.make(driver),
  ...(displayName === undefined ? {} : { displayName }),
});

const settings = (
  order: ReadonlyArray<ProviderInstanceId>,
  overrides: Partial<Parameters<typeof limitFailoverCommand>[1]> = {},
): Parameters<typeof limitFailoverCommand>[1] => ({
  usageLimitFailoverEnabled: true,
  usageLimitFailoverOrder: order,
  providerInstances: {
    [claudeWork]: instance("claudeAgent", "Work"),
    [claudeSpare]: instance("claudeAgent"),
  },
  projectSettingsOverrides: {},
  ...overrides,
});

describe("limitFailoverCommand", () => {
  it("moves a limited thread to the next instance and keeps its model", () => {
    const command = limitFailoverCommand(
      candidate(),
      settings([claude, claudeWork, claudeSpare]),
      now,
    );
    assert.equal(command?.type, "message.dispatch");
    if (command?.type !== "message.dispatch") return;
    assert.equal(command.manualContinuationOfRunId, runId);
    assert.deepEqual(command.modelSelection, {
      instanceId: claudeWork,
      model: "claude-opus-5-5",
      options: [{ id: "effort", value: "max" }],
    });
    assert.include(command.text, "switched to Work");
  });

  it("only moves forward through the order, so a chain ends instead of cycling", () => {
    const order = [claude, claudeWork, claudeSpare];
    const fromWork = limitFailoverCommand(
      candidate({ providerInstanceId: claudeWork }),
      settings(order),
      now,
    );
    assert.equal(
      fromWork?.type === "message.dispatch" ? fromWork.modelSelection?.instanceId : null,
      claudeSpare,
    );
    assert.isNull(
      limitFailoverCommand(candidate({ providerInstanceId: claudeSpare }), settings(order), now),
    );
  });

  it("starts at the top of the order when the current instance is not listed", () => {
    const command = limitFailoverCommand(candidate(), settings([claudeSpare]), now);
    assert.equal(
      command?.type === "message.dispatch" ? command.modelSelection?.instanceId : null,
      claudeSpare,
    );
  });

  it("uses the default model when failing over to another driver", () => {
    const command = limitFailoverCommand(candidate(), settings([claude, codex]), now);
    assert.equal(
      command?.type === "message.dispatch" ? command.modelSelection?.instanceId : null,
      codex,
    );
    assert.isUndefined(
      command?.type === "message.dispatch" ? command.modelSelection?.options : "unexpected",
    );
  });

  it("skips disabled instances", () => {
    const command = limitFailoverCommand(
      candidate(),
      settings([claude, claudeWork, claudeSpare], {
        providerInstances: {
          [claudeWork]: { ...instance("claudeAgent"), enabled: false },
          [claudeSpare]: instance("claudeAgent"),
        },
      }),
      now,
    );
    assert.equal(
      command?.type === "message.dispatch" ? command.modelSelection?.instanceId : null,
      claudeSpare,
    );
  });

  it("does nothing when off, after the reset, or once the wait-for-reset path is armed", () => {
    const order = [claude, claudeWork];
    assert.isNull(
      limitFailoverCommand(candidate(), settings(order, { usageLimitFailoverEnabled: false }), now),
    );
    assert.isNull(limitFailoverCommand(candidate(), settings(order), Date.parse(resetAt)));
    assert.isNull(
      limitFailoverCommand(
        candidate({
          limitRecovery: { runId, resetAt, autoResume: true, snooze: false },
        }),
        settings(order),
        now,
      ),
    );
  });
});

it.effect("idle sweeps skip SQL until the next wake time or a relevant event", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-07-01T09:00:00.000Z"));
    const startMs = Date.parse("2026-07-01T09:00:00.000Z");
    const queries = yield* Queue.unbounded<number>();
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const layer = UsageLimitRecoveryWorker.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Scheduler.layer,
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getLimitRecoveryCandidates: () =>
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((nowMs) => Queue.offer(queries, nowMs - startMs)),
                Effect.as([]),
              ),
            // One armed thread resets at 60s.
            getLimitRecoveryWakeAt: (now) =>
              Effect.succeed(
                DateTime.toEpochMillis(now) < startMs + 60_000 ? startMs + 60_000 : null,
              ),
          }),
          Layer.mock(ThreadManagement.ThreadManagementService)({}),
          Layer.mock(Orchestrator.OrchestratorV2)({
            streamDomainEvents: Stream.fromQueue(events),
          }),
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Effect.succeed({
              autoResumeLimitedThreads: true,
              snoozeLimitedThreads: false,
            } as never),
            streamChanges: Stream.never,
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      assert.equal(yield* Queue.take(queries), 0);
      // Eleven idle ticks before the recorded wake time, then the wake tick itself.
      yield* TestClock.adjust("60 seconds");
      assert.equal(yield* Queue.take(queries), 60_000);
      yield* Queue.offer(events, {
        type: "turn-item.updated",
        payload: { type: "assistant_message" },
      } as never);
      yield* TestClock.adjust("30 seconds");
      yield* Queue.offer(events, { type: "run.updated", payload: { status: "failed" } } as never);
      yield* TestClock.adjust("5 seconds");
      // A streaming item at 90s does not wake it; the failed run does on the 95s tick.
      assert.equal(yield* Queue.take(queries), 95_000);
    }).pipe(Effect.provide(layer));
  }),
);

const HOUR_MS = 60 * 60 * 1000;
const nowMs = Date.parse("2026-10-19T12:00:00.000Z");

const failedThread = (failedAgoMs: number, resetAgoMs: number) => {
  const failedAt = DateTime.makeUnsafe(nowMs - failedAgoMs);
  const candidate: ProjectionStore.ProjectionLimitRecoveryCandidate = {
    id: ThreadId.make("thread:limited"),
    status: "failed",
    lastErrorClass: "usage_limit",
    usageLimitResetAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs - resetAgoMs)),
    latestRunId: RunId.make("run:limited"),
    latestRunCompletedAt: failedAt,
    updatedAt: failedAt,
    archivedAt: null,
    settledOverride: null,
    pendingRuntimeRequest: null,
    limitRecovery: null,
    snoozedUntil: null,
    projectId: ProjectId.make("project-1"),
    providerInstanceId: claude,
    modelSelection: { instanceId: claude, model: "claude-opus-5-5" },
  };
  return candidate;
};

describe("limitRecoveryCommand arming", () => {
  it("does not freshly arm a failure whose reset passed days ago", () => {
    const thread = failedThread(5 * 24 * HOUR_MS, 4 * 24 * HOUR_MS);
    assert.isNull(limitRecoveryCommand(thread, true, nowMs));
    assert.isNull(limitRecoveryCommand(thread, true, nowMs, true));
  });

  it("still arms a failure whose reset only just passed", () => {
    const thread = failedThread(6 * HOUR_MS, HOUR_MS);
    const arm = limitRecoveryCommand(thread, true, nowMs);
    assert.equal(arm?.type, "thread.metadata.update");
  });

  it("arms a reset that is exactly 24 hours overdue", () => {
    const thread = failedThread(30 * HOUR_MS, 24 * HOUR_MS);
    const arm = limitRecoveryCommand(thread, true, nowMs);
    assert.equal(arm?.type, "thread.metadata.update");
  });

  it("does not arm a reset that is 24 hours and 1ms overdue", () => {
    const thread = failedThread(30 * HOUR_MS, 24 * HOUR_MS + 1);
    assert.isNull(limitRecoveryCommand(thread, true, nowMs));
  });
});
