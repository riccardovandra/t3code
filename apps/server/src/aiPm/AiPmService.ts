import { AiPmError, type AiPmListResult, type AiPmBriefResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Path from "effect/Path";
import * as DateTime from "effect/DateTime";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProcessRunner from "../processRunner.ts";

const OptionalText = Schema.optionalKey(Schema.String);
const OpenVersion = Schema.optionalKey(
  Schema.NullOr(
    Schema.Struct({
      version: OptionalText,
      outcome: OptionalText,
      ship_when: OptionalText,
    }),
  ),
);
const Progress = { done: Schema.Number, total: Schema.Number };
const SourceSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  owner: Schema.String,
  area: OptionalText,
  now: Schema.String,
  waiting_on_you: Schema.Number,
  ...Progress,
  closed: Schema.optionalKey(Schema.NullOr(Schema.String)),
  open_version: OpenVersion,
});
const SourceStep = Schema.Struct({
  ref: Schema.String,
  title: Schema.String,
  what: OptionalText,
  owner: OptionalText,
  state: Schema.Literals(["done", "active", "todo", "blocked", "parked", "check"]),
  waitingTitles: Schema.optionalKey(Schema.Array(Schema.String)),
  history: Schema.optionalKey(
    Schema.Array(Schema.Struct({ date: Schema.String, text: Schema.String })),
  ),
  specError: OptionalText,
  syncDue: Schema.optionalKey(Schema.Boolean),
  sync: Schema.optionalKey(
    Schema.Struct({
      error: OptionalText,
      flags: Schema.optionalKey(Schema.Array(Schema.Struct({ kind: OptionalText }))),
    }),
  ),
});
const SourceBrief = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  owner: Schema.String,
  objective: OptionalText,
  now: OptionalText,
  updated: OptionalText,
  progress: Schema.Struct(Progress),
  open_version: OpenVersion,
  next_actions: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      owner: Schema.String,
      step: OptionalText,
      ref: OptionalText,
      why: OptionalText,
    }),
  ),
  risks: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ code: Schema.String, title: Schema.String, context: OptionalText }),
    ),
  ),
  plan: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      version: OptionalText,
      kind: OptionalText,
      shipped: OptionalText,
      steps: Schema.Array(SourceStep),
    }),
  ),
});

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeSummaries = Schema.decodeUnknownEffect(Schema.Array(SourceSummary));
const decodeBrief = Schema.decodeUnknownEffect(SourceBrief);

export class AiPmService extends Context.Service<
  AiPmService,
  {
    readonly list: () => Effect.Effect<AiPmListResult, AiPmError>;
    readonly brief: (input: {
      readonly projectId: string;
    }) => Effect.Effect<AiPmBriefResult, AiPmError>;
  }
>()("t3/aiPm/AiPmService") {}

const text = (value: string | undefined): string | null =>
  value === undefined ? null : value.slice(0, 8_000);

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;
  // Electron's PATH can omit user-installed tools; the fallback still uses normal executable lookup.
  const env = {
    ...environment,
    PATH: [environment.PATH, path.join(home, ".local", "bin")]
      .filter(Boolean)
      .join(platform === "win32" ? ";" : ":"),
  };
  const command = environment.T3CODE_AIPM_EXECUTABLE?.trim() || "aipm";
  const read = Effect.fn("AiPmService.read")(function* (args: ReadonlyArray<string>) {
    const result = yield* runner
      .run({
        command,
        args,
        env,
        timeout: "15 seconds",
        maxOutputBytes: 2 * 1024 * 1024,
        outputMode: "error",
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new AiPmError({
              reason:
                error._tag === "ProcessSpawnError"
                  ? "unavailable"
                  : error._tag === "ProcessTimeoutError"
                    ? "timeout"
                    : error._tag === "ProcessOutputLimitError"
                      ? "output_limit"
                      : "command_failed",
            }),
        ),
      );
    if (result.timedOut) return yield* new AiPmError({ reason: "timeout" });
    if (result.stdoutTruncated || result.stderrTruncated)
      return yield* new AiPmError({ reason: "output_limit" });
    if (result.code !== 0) return yield* new AiPmError({ reason: "command_failed" });
    return yield* decodeJson(result.stdout).pipe(
      Effect.mapError(() => new AiPmError({ reason: "invalid_data" })),
    );
  });
  const list = Effect.fn("AiPmService.list")(function* () {
    const raw = yield* read(["list", "--json"]);
    const projects = yield* decodeSummaries(raw).pipe(
      Effect.mapError(() => new AiPmError({ reason: "invalid_data" })),
    );
    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        owner: p.owner,
        area: p.area ?? null,
        now: p.now,
        waitingOnYou: p.waiting_on_you,
        done: p.done,
        total: p.total,
        closed: p.closed ?? null,
        version: text(p.open_version?.version),
        outcome: text(p.open_version?.outcome),
      })),
      fetchedAt: DateTime.formatIso(yield* DateTime.now),
    };
  });
  const brief = Effect.fn("AiPmService.brief")(function* ({
    projectId,
  }: {
    readonly projectId: string;
  }) {
    // Resolve IDs against the read-only list rather than treating arbitrary strings as CLI arguments.
    const board = yield* list();
    if (!board.projects.some((p) => p.id === projectId))
      return yield* new AiPmError({ reason: "project_not_found" });
    const raw = yield* read(["brief", projectId, "--json"]);
    const p = yield* decodeBrief(raw).pipe(
      Effect.mapError(() => new AiPmError({ reason: "invalid_data" })),
    );
    if (p.id !== projectId) return yield* new AiPmError({ reason: "invalid_data" });
    return {
      id: p.id,
      name: p.name,
      owner: p.owner,
      objective: text(p.objective) ?? "",
      now: text(p.now) ?? "",
      updated: text(p.updated),
      done: p.progress.done,
      total: p.progress.total,
      version: text(p.open_version?.version),
      outcome: text(p.open_version?.outcome),
      shipWhen: text(p.open_version?.ship_when),
      next: p.next_actions.map((n) => ({
        title: n.title,
        owner: n.owner,
        step: text(n.ref ?? n.step),
        why: text(n.why),
      })),
      risks: (p.risks ?? []).map((r) => ({
        code: r.code,
        title: r.title,
        context: text(r.context),
      })),
      phases: p.plan.map((phase) => ({
        name: phase.name,
        version: text(phase.version),
        kind: text(phase.kind),
        shipped: text(phase.shipped),
        steps: phase.steps.map((step) => ({
          ref: step.ref,
          title: step.title,
          what: text(step.what),
          owner: step.owner ?? "agent",
          state: step.state,
          waitingTitles: step.waitingTitles ?? [],
          lastProgress: step.history?.length
            ? text(`${step.history[0]!.date}: ${step.history[0]!.text}`)
            : null,
          warnings: [
            ...(step.specError ? ["Linked specification could not be read."] : []),
            ...(step.syncDue ? ["Specification changed since the last status check."] : []),
            ...(step.sync?.error ? ["Last status check failed."] : []),
            ...(step.sync?.flags?.length ? ["Status evidence needs review."] : []),
          ],
        })),
      })),
      fetchedAt: DateTime.formatIso(yield* DateTime.now),
    };
  });
  return AiPmService.of({ list, brief });
});

export const layer = Layer.effect(AiPmService, make);
