import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  SkillLibraryError,
  SkillSourceId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as SkillLibrary from "./SkillLibrary.ts";
import * as SkillSources from "./SkillSources.ts";

const claude = (skills: ServerProvider["skills"], cwd?: string): ServerProvider => ({
  driver: ProviderDriverKind.make("claudeAgent"),
  instanceId: ProviderInstanceId.make("claude"),
  enabled: true,
  installed: true,
  version: "2.1.0",
  status: "ready",
  checkedAt: "2026-10-23T00:00:00Z",
  auth: { status: "authenticated" },
  models: [],
  skills: cwd === undefined ? skills : [],
  slashCommands: [],
  ...(cwd === undefined
    ? {}
    : { workspaceSnapshots: [{ cwd, skills, slashCommands: [], checkedAt: "" }] }),
});

const previewItem = (name: string) => ({
  name,
  folder: name,
  description: `${name} skill`,
  files: [],
  filesTruncated: false,
  scripts: name === "deploy",
});

/** The service over a temp settings folder, a stub preview and stub provider snapshots. */
const withSources = <A, E>(
  body: (input: {
    readonly sources: SkillSources.SkillSources["Service"];
    readonly home: string;
    readonly providers: Ref.Ref<ReadonlyArray<ServerProvider>>;
    readonly previews: Ref.Ref<number>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-sources-" });
    const home = path.join(base, "home");
    yield* fileSystem.makeDirectory(home, { recursive: true });
    const providers = yield* Ref.make<ReadonlyArray<ServerProvider>>([]);
    const previews = yield* Ref.make(0);
    const library = {
      preview: ({ source }: { readonly source: string }) =>
        Ref.update(previews, (count) => count + 1).pipe(
          Effect.andThen(
            source === "broken/repo"
              ? Effect.fail(new SkillLibraryError({ reason: "noSkills", message: "No skills." }))
              : Effect.succeed({ skills: [previewItem("deploy"), previewItem("notes")] }),
          ),
        ),
    } as unknown as SkillLibrary.SkillLibrary["Service"];
    const registry = {
      getProviders: Ref.get(providers),
    } as unknown as ProviderRegistry.ProviderRegistry["Service"];
    const sources = yield* SkillSources.SkillSources.pipe(
      Effect.provide(
        SkillSources.layer.pipe(
          Layer.provide(Layer.succeed(SkillLibrary.SkillLibrary, library)),
          Layer.provide(Layer.succeed(ProviderRegistry.ProviderRegistry, registry)),
          Layer.provide(ServerSettingsService.layerTest()),
          Layer.provide(ServerConfig.layerTest(base, base)),
        ),
      ),
      Effect.provideService(HostProcess.Environment, {
        HOME: home,
        CLAUDE_CONFIG_DIR: "",
      }),
    );
    return yield* body({ sources, home, providers, previews });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("starts from the ai-config library and saves edits", () =>
  withSources(({ sources }) =>
    Effect.gen(function* () {
      assert.deepEqual((yield* sources.list).sources, SkillSources.DEFAULT_SKILL_SOURCES);

      const added = yield* sources.upsert({ label: "Team Skills", source: "acme/skills" });
      assert.deepEqual(
        added.sources.map((source) => [source.id, source.label, source.source]),
        [
          ["ai-config", "ai-config", SkillSources.DEFAULT_SKILL_SOURCES[0]?.source],
          ["team-skills", "Team Skills", "acme/skills"],
        ],
      );
      // Same label, new id; editing keeps the id and position.
      const second = yield* sources.upsert({ label: "Team Skills", source: "acme/more" });
      assert.equal(second.sources[2]?.id, "team-skills-2");
      const edited = yield* sources.upsert({
        id: SkillSourceId.make("team-skills"),
        label: "Team",
        source: "acme/skills/tree",
      });
      assert.deepEqual(edited.sources[1], {
        id: "team-skills",
        label: "Team",
        source: "acme/skills/tree",
      });

      // Removing the default keeps it gone: the saved file now owns the list.
      yield* sources.remove({ id: SkillSourceId.make("ai-config") });
      assert.deepEqual(
        (yield* sources.list).sources.map((source) => source.id),
        ["team-skills", "team-skills-2"],
      );
      const missing = yield* sources
        .remove({ id: SkillSourceId.make("ai-config") })
        .pipe(Effect.flip);
      assert.equal(missing.reason, "notFound");
    }),
  ),
);

it.effect("lists each source's skills with where they are installed, caching previews", () =>
  withSources(({ sources, home, providers, previews }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const project = path.join(home, "work", "app");
      yield* sources.upsert({ label: "Broken", source: "broken/repo" });
      yield* Ref.set(providers, [
        claude([
          // Installed for the environment, through Claude's link.
          {
            name: "deploy",
            path: path.join(home, ".claude", "skills", "deploy", "SKILL.md"),
            scope: "user",
            enabled: true,
          },
          // A plugin's skill of the same name isn't an install.
          {
            name: "notes",
            path: path.join(home, ".claude", "plugins", "x", "skills", "notes", "SKILL.md"),
            scope: "user",
            enabled: true,
          },
        ]),
        {
          ...claude(
            [
              {
                name: "notes",
                path: path.join(project, ".agents", "skills", "notes", "SKILL.md"),
                scope: "project",
                enabled: true,
              },
            ],
            project,
          ),
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
        },
      ]);

      const listed = yield* sources.library({});
      const [library, broken] = listed.sources;
      assert.deepEqual(
        library?.skills.map((skill) => [skill.name, skill.scripts, skill.installedAt]),
        [
          ["deploy", true, [{ kind: "environment" }]],
          ["notes", false, [{ kind: "project", cwd: project }]],
        ],
      );
      assert.deepEqual([broken?.skills, broken?.error], [[], "No skills."]);
      assert.equal(yield* Ref.get(previews), 2);

      // A second read reuses the previews; refresh fetches them again.
      yield* sources.library({ sourceId: SkillSourceId.make("ai-config") });
      assert.equal(yield* Ref.get(previews), 2);
      yield* sources.library({ sourceId: SkillSourceId.make("ai-config"), refresh: true });
      assert.equal(yield* Ref.get(previews), 3);

      const unknown = yield* sources
        .library({ sourceId: SkillSourceId.make("nope") })
        .pipe(Effect.flip);
      assert.equal(unknown.reason, "notFound");
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);
