import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as SkillTrash from "./SkillTrash.ts";

/** A temp home with one skill folder, a link to it and a lock naming it, and the trash. */
const withTrash = <A, E>(
  body: (input: {
    readonly trash: SkillTrash.SkillTrash["Service"];
    readonly folder: string;
    readonly link: string;
    readonly lock: string;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = yield* fileSystem.realPath(
      yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-trash-" }),
    );
    const folder = path.join(base, "home", ".agents", "skills", "notes");
    const link = path.join(base, "home", ".claude", "skills", "notes");
    const lock = path.join(base, "home", ".agents", ".skill-lock.json");
    yield* fileSystem.makeDirectory(folder, { recursive: true });
    yield* fileSystem.writeFileString(path.join(folder, "SKILL.md"), "notes\n");
    yield* fileSystem.makeDirectory(path.dirname(link), { recursive: true });
    yield* fileSystem.symlink(folder, link);
    yield* fileSystem.writeFileString(
      lock,
      JSON.stringify({
        version: 3,
        skills: { notes: { source: "acme/skills" }, other: { source: "acme/other" } },
      }),
    );
    const trash = yield* SkillTrash.SkillTrash.pipe(
      Effect.provide(SkillTrash.layer),
      Effect.provide(ServerConfig.ServerConfig.layerTest(base, path.join(base, "t3"))),
    );
    return yield* body({ trash, folder, link, lock });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const put = (
  trash: SkillTrash.SkillTrash["Service"],
  input: { readonly folder: string; readonly link: string; readonly lock: string },
) =>
  trash.put({
    name: "notes",
    target: { kind: "environment" },
    paths: [input.folder, input.link],
    lock: { file: input.lock, key: "notes" },
  });

it.effect("refuses to restore over something that took a skill's place", () =>
  withTrash((input) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const entry = yield* put(input.trash, input);
      yield* fileSystem.makeDirectory(input.folder);
      yield* fileSystem.writeFileString(path.join(input.folder, "SKILL.md"), "newer\n");

      const failure = yield* input.trash.restore(entry.id).pipe(Effect.flip);
      assert.equal(failure.reason, "occupied");
      // Nothing was overwritten or half-restored, and the entry stays in the trash.
      assert.equal(
        yield* fileSystem.readFileString(path.join(input.folder, "SKILL.md")),
        "newer\n",
      );
      assert.isFalse(yield* fileSystem.exists(input.link));
      assert.deepEqual(
        (yield* input.trash.list).map((listed) => listed.id),
        [entry.id],
      );
    }),
  ),
);

it.effect("refuses to restore a lock entry the lock has again, changing nothing", () =>
  withTrash((input) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const entry = yield* put(input.trash, input);
      const reinstalled = JSON.stringify({ version: 3, skills: { notes: { source: "new" } } });
      yield* fileSystem.writeFileString(input.lock, reinstalled);

      const failure = yield* input.trash.restore(entry.id).pipe(Effect.flip);
      assert.equal(failure.reason, "occupied");
      assert.equal(yield* fileSystem.readFileString(input.lock), reinstalled);
      assert.isFalse(yield* fileSystem.exists(input.folder));
    }),
  ),
);

it.effect("keeps the rest of the lock, and deletes only the entry asked for", () =>
  withTrash((input) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const first = yield* put(input.trash, input);
      assert.deepEqual(JSON.parse(yield* fileSystem.readFileString(input.lock)), {
        version: 3,
        skills: { other: { source: "acme/other" } },
      });
      // A second skill of the same name, removed later.
      yield* fileSystem.makeDirectory(input.folder);
      yield* fileSystem.writeFileString(path.join(input.folder, "SKILL.md"), "again\n");
      const second = yield* input.trash.put({
        name: "notes",
        target: { kind: "environment" },
        paths: [input.folder],
      });

      yield* input.trash.deletePermanently(first.id);
      assert.deepEqual(
        (yield* input.trash.list).map((entry) => entry.id),
        [second.id],
      );
      const missing = yield* input.trash.restore(first.id).pipe(Effect.flip);
      assert.equal(missing.reason, "notFound");
      const traversal = yield* input.trash.deletePermanently("../home").pipe(Effect.flip);
      assert.equal(traversal.reason, "notFound");

      yield* input.trash.restore(second.id);
      assert.equal(
        yield* fileSystem.readFileString(path.join(input.folder, "SKILL.md")),
        "again\n",
      );
    }),
  ),
);

it.effect("moves across filesystems by copying, then deleting the source", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-skill-copy-" });
    const from = path.join(base, "from");
    yield* fileSystem.makeDirectory(path.join(from, "bin"), { recursive: true });
    yield* fileSystem.writeFileString(path.join(from, "SKILL.md"), "copied\n");
    yield* fileSystem.writeFileString(path.join(from, "bin", "run"), "#!/bin/sh\n");
    yield* fileSystem.symlink("SKILL.md", path.join(from, "README.md"));
    const to = path.join(base, "to");

    yield* SkillTrash.moveByCopy(from, to);
    assert.isFalse(yield* fileSystem.exists(from));
    assert.equal(yield* fileSystem.readFileString(path.join(to, "SKILL.md")), "copied\n");
    assert.equal(yield* fileSystem.readFileString(path.join(to, "bin", "run")), "#!/bin/sh\n");
    // A relative link stays relative, so it still resolves inside the moved folder.
    assert.equal(yield* fileSystem.readLink(path.join(to, "README.md")), "SKILL.md");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
