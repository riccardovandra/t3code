import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { ProjectionLimitRecoveryCandidate } from "./ProjectionStore.ts";
import { limitFailoverCommand } from "./UsageLimitRecoveryWorker.ts";

const claude = ProviderInstanceId.make("claudeAgent");
const claudeWork = ProviderInstanceId.make("claudeAgent_work");
const claudeSpare = ProviderInstanceId.make("claudeAgent_spare");
const codex = ProviderInstanceId.make("codex");
const runId = RunId.make("run-1");
const failedAt = Date.parse("2026-10-27T10:00:00.000Z");
const resetAt = "2026-10-27T15:00:00.000Z";
const now = failedAt + 60_000;

const candidate = (
  overrides: Partial<ProjectionLimitRecoveryCandidate> = {},
): ProjectionLimitRecoveryCandidate => ({
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
