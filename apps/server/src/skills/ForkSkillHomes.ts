/**
 * Fork: the skill folders of Claude provider instances with their own home
 * (`CLAUDE_CONFIG_DIR` or a home path, such as `~/.claude-bark`). The bundled
 * `skills` CLI only links environment installs into `~/.claude/skills`, so
 * SkillLibrary links them into these folders too and counts them as the
 * environment's own skill folders.
 *
 * @module ForkSkillHomes
 */
import { ClaudeSettings, type ProviderInstanceConfigMap } from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);

export class ForkSkillHomes extends Context.Service<
  ForkSkillHomes,
  {
    /**
     * `<home>/skills` of each enabled Claude instance whose home isn't
     * `<home folder>/.claude`, the one the CLI links already.
     */
    readonly claudeSkillFolders: (homeFolder: string) => Effect.Effect<ReadonlyArray<string>>;
    /**
     * Link each installed folder (in `~/.agents/skills`) into `folders`, by
     * its name. An entry already there, link or the user's own copy, stays.
     */
    readonly linkInto: (
      folders: ReadonlyArray<string>,
      installed: ReadonlyArray<string>,
    ) => Effect.Effect<void>;
    /** Delete links named `folderName` in `folders` whose target is gone. */
    readonly unlinkDangling: (
      folders: ReadonlyArray<string>,
      folderName: string,
    ) => Effect.Effect<void>;
  }
>()("t3/skills/ForkSkillHomes") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const settingsService = yield* ServerSettingsService;
  const hostEnvironment = yield* HostProcess.Environment;

  const claudeSkillFolders: ForkSkillHomes["Service"]["claudeSkillFolders"] = Effect.fn(
    "ForkSkillHomes.claudeSkillFolders",
  )(function* (homeFolder) {
    const providers = yield* providerRegistry.getProviders;
    const instances = yield* settingsService.getSettings.pipe(
      Effect.map((settings) => settings.providerInstances),
      Effect.orElseSucceed((): ProviderInstanceConfigMap => ({})),
    );
    const standard = path.resolve(path.join(homeFolder, ".claude"));
    const folders = new Set<string>();
    for (const provider of providers) {
      if (!provider.enabled || provider.driver !== "claudeAgent") continue;
      const instance = Object.hasOwn(instances, provider.instanceId)
        ? instances[provider.instanceId]
        : undefined;
      const config = decodeClaudeSettings(instance?.config ?? {});
      if (Option.isNone(config)) continue;
      // Resolved as the driver does, against the home folder SkillLibrary uses.
      const home = yield* Effect.gen(function* () {
        const environment = yield* mergeProviderInstanceEnvironment(
          instance?.environment,
          hostEnvironment,
        );
        return yield* resolveClaudeHomePath(config.value, environment);
      }).pipe(
        Effect.provideService(HostProcess.HomeDirectory, homeFolder),
        Effect.provideService(Path.Path, path),
      );
      if (home !== standard) folders.add(path.join(home, "skills"));
    }
    return [...folders];
  });

  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));
  const isLink = (target: string) =>
    fileSystem.readLink(target).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  const linkInto: ForkSkillHomes["Service"]["linkInto"] = Effect.fn("ForkSkillHomes.linkInto")(
    function* (folders, installed) {
      for (const folder of folders) {
        for (const source of installed) {
          const link = path.join(folder, path.basename(source));
          // `exists` follows links, so a dangling one is replaced.
          if (yield* exists(link)) continue;
          if (yield* isLink(link)) yield* fileSystem.remove(link).pipe(Effect.ignore);
          yield* fileSystem
            .makeDirectory(folder, { recursive: true })
            .pipe(Effect.andThen(fileSystem.symlink(source, link)), Effect.ignore({ log: true }));
        }
      }
    },
  );

  const unlinkDangling: ForkSkillHomes["Service"]["unlinkDangling"] = Effect.fn(
    "ForkSkillHomes.unlinkDangling",
  )(function* (folders, folderName) {
    for (const folder of folders) {
      const link = path.join(folder, folderName);
      if ((yield* isLink(link)) && !(yield* exists(link))) {
        yield* fileSystem.remove(link).pipe(Effect.ignore);
      }
    }
  });

  return ForkSkillHomes.of({ claudeSkillFolders, linkInto, unlinkDangling });
});

export const layer = Layer.effect(ForkSkillHomes, make);
