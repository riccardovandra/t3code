/**
 * Fork: saved skill sources and the library of skills they hold.
 *
 * The list lives in `skill-sources.json` beside settings.json, the way the MCP
 * hub keeps its servers, so no upstream settings schema changes. Until the
 * user saves a change, the list is the default library source. The library
 * previews each source through SkillLibrary (cached, since a preview fetches
 * the repository) and marks where each skill is installed from the folders
 * the enabled agents report.
 *
 * @module SkillSources
 */
import {
  type SavedSkillSource,
  SavedSkillSource as SavedSkillSourceSchema,
  type ServerProvider,
  type SkillInstallTarget,
  type SkillLibraryListResult,
  type SkillLibrarySkill,
  type SkillLibrarySourceListing,
  type SkillPreviewItem,
  SkillSourceId,
  type SkillSourceRemoveInput,
  SkillSourcesError,
  type SkillSourcesListResult,
  type SkillSourceUpsertInput,
  type SkillLibraryListInput,
} from "@t3tools/contracts";
import { agentSkillFolderRoots } from "@t3tools/provider-core/server/AgentSkillFolders";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ForkSkillHomes from "./ForkSkillHomes.ts";
import * as SkillLibrary from "./SkillLibrary.ts";

/** Riccardo's library: ai-config's shared skills. The tree URL names the folder. */
export const DEFAULT_SKILL_SOURCES: ReadonlyArray<SavedSkillSource> = [
  {
    id: SkillSourceId.make("ai-config"),
    label: "ai-config",
    source: "https://github.com/riccardovandra/ai-config/tree/main/shared/skills",
  },
];

/** A preview fetches the whole source; reuse one for this long unless asked to refresh. */
const PREVIEW_TTL_MS = 10 * 60_000;

const StoredSources = Schema.fromJsonString(
  Schema.Struct({ sources: Schema.Array(SavedSkillSourceSchema) }),
);
const decodeStored = Schema.decodeUnknownEffect(StoredSources);
const encodeStored = Schema.encodeEffect(StoredSources);

export class SkillSources extends Context.Service<
  SkillSources,
  {
    readonly list: Effect.Effect<SkillSourcesListResult, SkillSourcesError>;
    readonly upsert: (
      input: SkillSourceUpsertInput,
    ) => Effect.Effect<SkillSourcesListResult, SkillSourcesError>;
    readonly remove: (
      input: SkillSourceRemoveInput,
    ) => Effect.Effect<SkillSourcesListResult, SkillSourcesError>;
    /** Each saved source's skills, or one source's, with where they are installed. */
    readonly library: (
      input: SkillLibraryListInput,
    ) => Effect.Effect<SkillLibraryListResult, SkillSourcesError>;
  }
>()("t3/skills/SkillSources") {}

/** A skill an agent reports, from its environment list (`cwd` null) or a project's. */
export interface ReportedSkill {
  readonly cwd: string | null;
  readonly name: string;
  readonly path: string;
}

/**
 * Where each library skill is installed: a reported skill with the same folder
 * or name, directly in one of the environment's skill folders or one of its
 * project's. Plugin and built-in skills live elsewhere and don't count.
 */
function libraryInstalledAt(input: {
  readonly skills: ReadonlyArray<Pick<SkillPreviewItem, "name" | "folder">>;
  readonly reported: ReadonlyArray<ReportedSkill>;
  readonly environmentRoots: ReadonlySet<string>;
  readonly projectRoots: (cwd: string) => ReadonlySet<string>;
  readonly dirname: (path: string) => string;
  readonly basename: (path: string) => string;
}): ReadonlyMap<string, ReadonlyArray<SkillInstallTarget>> {
  const byKey = new Map<string, string>();
  for (const skill of input.skills) {
    byKey.set(`folder:${skill.folder.toLowerCase()}`, skill.folder);
    byKey.set(`name:${skill.name.trim().toLowerCase()}`, skill.folder);
  }
  const found = new Map<string, Map<string, SkillInstallTarget>>();
  for (const skill of input.reported) {
    const folder = input.dirname(skill.path);
    const libraryFolder =
      byKey.get(`folder:${input.basename(folder).toLowerCase()}`) ??
      byKey.get(`name:${skill.name.trim().toLowerCase()}`);
    if (libraryFolder === undefined) continue;
    const parent = input.dirname(folder);
    const target: SkillInstallTarget | undefined = input.environmentRoots.has(parent)
      ? { kind: "environment" }
      : skill.cwd !== null && input.projectRoots(skill.cwd).has(parent)
        ? { kind: "project", cwd: skill.cwd }
        : undefined;
    if (target === undefined) continue;
    const targets = found.get(libraryFolder) ?? new Map<string, SkillInstallTarget>();
    targets.set(target.kind === "environment" ? "" : target.cwd, target);
    found.set(libraryFolder, targets);
  }
  // The environment first, then projects by folder.
  return new Map(
    [...found].map(([folder, targets]) => [
      folder,
      [...targets].toSorted(([left], [right]) => left.localeCompare(right)).map(([, t]) => t),
    ]),
  );
}

/** A lowercase slug from a label, unique among `taken`. */
function sourceIdFor(label: string, taken: ReadonlySet<string>): SkillSourceId {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || "source";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return SkillSourceId.make(id);
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { settingsPath } = yield* ServerConfig.ServerConfig;
  const skillLibrary = yield* SkillLibrary.SkillLibrary;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const claudeHomes = yield* ForkSkillHomes.ForkSkillHomes;
  const environment = yield* HostProcess.Environment;
  const home = environment.HOME?.trim() || environment.USERPROFILE?.trim() || "";
  const filePath = path.join(path.dirname(settingsPath), "skill-sources.json");

  const lock = yield* Semaphore.make(1);
  const previews = yield* Ref.make(
    new Map<
      string,
      {
        readonly at: number;
        readonly result:
          | { readonly skills: ReadonlyArray<SkillPreviewItem> }
          | { readonly error: string };
      }
    >(),
  );

  const storageFailed = (message: string) => new SkillSourcesError({ reason: "storage", message });

  const load = Effect.gen(function* () {
    if (!(yield* fileSystem.exists(filePath))) return DEFAULT_SKILL_SOURCES;
    return (yield* fileSystem.readFileString(filePath).pipe(Effect.flatMap(decodeStored))).sources;
  }).pipe(Effect.mapError(() => storageFailed(`Couldn't read ${filePath}.`)));

  const save = (sources: ReadonlyArray<SavedSkillSource>) =>
    encodeStored({ sources }).pipe(
      Effect.flatMap((contents) =>
        writeFileStringAtomically({ filePath, contents: `${contents}\n` }),
      ),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError(() => storageFailed(`Couldn't write ${filePath}.`)),
      Effect.as({ sources }),
    );

  const list: SkillSources["Service"]["list"] = load.pipe(
    Effect.map((sources) => ({ sources })),
    Effect.withSpan("SkillSources.list"),
  );

  const upsert: SkillSources["Service"]["upsert"] = Effect.fn("SkillSources.upsert")(
    function* (input) {
      return yield* Effect.gen(function* () {
        const sources = yield* load;
        const id = input.id ?? sourceIdFor(input.label, new Set(sources.map((s) => s.id)));
        const next = { id, label: input.label, source: input.source };
        const index = sources.findIndex((source) => source.id === id);
        return yield* save(
          index === -1 ? [...sources, next] : sources.map((s, i) => (i === index ? next : s)),
        );
      }).pipe(lock.withPermits(1));
    },
  );

  const remove: SkillSources["Service"]["remove"] = Effect.fn("SkillSources.remove")(
    function* (input) {
      return yield* Effect.gen(function* () {
        const sources = yield* load;
        if (!sources.some((source) => source.id === input.id)) {
          return yield* new SkillSourcesError({
            reason: "notFound",
            message: "That source isn't saved here.",
          });
        }
        return yield* save(sources.filter((source) => source.id !== input.id));
      }).pipe(lock.withPermits(1));
    },
  );

  const previewOf = Effect.fnUntraced(function* (source: string, refresh: boolean) {
    const now = yield* Clock.currentTimeMillis;
    const cached = (yield* Ref.get(previews)).get(source);
    if (!refresh && cached !== undefined && now - cached.at < PREVIEW_TTL_MS) return cached.result;
    const result = yield* skillLibrary.preview({ source }).pipe(
      Effect.map((preview) => ({ skills: preview.skills })),
      Effect.catchTags({
        SkillLibraryError: (error) => Effect.succeed({ error: error.message }),
      }),
    );
    yield* Ref.update(previews, (known) => new Map(known).set(source, { at: now, result }));
    return result;
  });

  const realPath = (target: string) =>
    fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => target));
  const rootsOf = (root: string, folders: ReadonlyArray<string>) =>
    Effect.forEach(
      folders.map((folder) => (path.isAbsolute(folder) ? folder : path.join(root, folder))),
      (folder) => realPath(folder).pipe(Effect.map((real) => [folder, real])),
    ).pipe(Effect.map((pairs) => new Set(pairs.flat())));

  const reportedSkills = (providers: ReadonlyArray<ServerProvider>) =>
    providers.flatMap((provider): ReadonlyArray<ReportedSkill> => [
      ...provider.skills.map((skill) => ({ cwd: null, name: skill.name, path: skill.path })),
      ...(provider.workspaceSnapshots ?? []).flatMap((snapshot) =>
        snapshot.skills.map((skill) => ({ cwd: snapshot.cwd, name: skill.name, path: skill.path })),
      ),
    ]);

  const library: SkillSources["Service"]["library"] = Effect.fn("SkillSources.library")(
    function* (input) {
      const sources = (yield* load).filter(
        (source) => input.sourceId === undefined || source.id === input.sourceId,
      );
      if (input.sourceId !== undefined && sources.length === 0) {
        return yield* new SkillSourcesError({
          reason: "notFound",
          message: "That source isn't saved here.",
        });
      }
      const previewed = yield* Effect.forEach(
        sources,
        (source) =>
          previewOf(source.source, input.refresh === true).pipe(
            Effect.map((result) => ({ source, result })),
          ),
        { concurrency: 4 },
      );
      const providers = (yield* providerRegistry.getProviders).filter(
        (provider) => provider.enabled,
      );
      const reported = reportedSkills(providers).filter(
        (skill) => path.isAbsolute(skill.path) && path.basename(skill.path) === "SKILL.md",
      );
      const environmentRoots = yield* rootsOf(home, [
        ...agentSkillFolderRoots("home"),
        ...(yield* claudeHomes.claudeSkillFolders(home)),
      ]);
      const projectRoots = new Map<string, ReadonlySet<string>>();
      for (const cwd of new Set(
        reported.flatMap((skill) => (skill.cwd === null ? [] : [skill.cwd])),
      )) {
        projectRoots.set(cwd, yield* rootsOf(cwd, agentSkillFolderRoots("project")));
      }
      return {
        sources: previewed.map(({ source, result }): SkillLibrarySourceListing => {
          if ("error" in result) return { source, skills: [], error: result.error };
          const installedAt = libraryInstalledAt({
            skills: result.skills,
            reported,
            environmentRoots,
            projectRoots: (cwd) => projectRoots.get(cwd) ?? new Set(),
            dirname: path.dirname,
            basename: path.basename,
          });
          return {
            source,
            skills: result.skills.map((skill): SkillLibrarySkill => ({
              name: skill.name,
              folder: skill.folder,
              description: skill.description,
              scripts: skill.scripts,
              installedAt: installedAt.get(skill.folder) ?? [],
            })),
          };
        }),
      };
    },
  );

  return SkillSources.of({ list, upsert, remove, library });
});

export const layer = Layer.effect(SkillSources, make).pipe(Layer.provide(ForkSkillHomes.layer));
